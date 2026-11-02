// Webcam motion engine. Uses OpenCV.js (self-hosted /opencv.js) for frame
// differencing + contour boxes; falls back to plain canvas maths if OpenCV
// fails to load, so the demo never dies on venue Wi-Fi.

const W = 160;
const H = 120;

let cvReady = null;
export function loadOpenCV(timeoutMs = 20000) {
  if (cvReady) return cvReady;
  cvReady = new Promise((resolve) => {
    const done = (ok) => resolve(ok);
    const timer = setTimeout(() => done(false), timeoutMs);
    const check = () => {
      const cv = window.cv;
      if (cv && cv.Mat) {
        clearTimeout(timer);
        done(true);
        return true;
      }
      return false;
    };
    if (check()) return;
    const s = document.createElement('script');
    s.src = '/opencv.js';
    s.async = true;
    s.onload = () => {
      const cv = window.cv;
      if (!cv) return;
      if (cv instanceof Promise || typeof cv.then === 'function') {
        cv.then((m) => {
          window.cv = m;
          check();
        });
      } else if (!check()) {
        cv.onRuntimeInitialized = () => check();
        const iv = setInterval(() => check() && clearInterval(iv), 200);
      }
    };
    s.onerror = () => {
      // self-hosted copy missing: try the CDN copy before giving up
      if (!s.dataset.cdn) {
        const c = s.cloneNode();
        c.dataset.cdn = '1';
        c.src = 'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js';
        c.onload = s.onload;
        c.onerror = () => {
          clearTimeout(timer);
          done(false);
        };
        document.head.appendChild(c);
        return;
      }
      clearTimeout(timer);
      done(false);
    };
    document.head.appendChild(s);
  });
  return cvReady;
}

export class MotionEngine {
  constructor(video, overlay) {
    this.video = video;
    this.overlay = overlay; // canvas drawn over the preview
    this.work = document.createElement('canvas');
    this.work.width = W;
    this.work.height = H;
    this.wctx = this.work.getContext('2d', { willReadFrequently: true });
    this.prevGray = null; // fallback
    this.cvPrev = null;
    this.useCV = false;
    this.raw = 0;
    this.noise = 2;
    this.motion = 0; // 0..100 calibrated
    this.shake = false;
    this.boxes = [];
    this.shrink = null; // {x,y,w,h} in 0..1 when sabotaged
    this.running = false;
  }

  async start() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
      audio: false,
    });
    this.video.srcObject = stream;
    await this.video.play();
    this.useCV = await loadOpenCV();
    this.running = true;
    this.loop();
    return this.useCV;
  }

  stop() {
    this.running = false;
    const s = this.video.srcObject;
    if (s) s.getTracks().forEach((t) => t.stop());
  }

  async calibrate(ms = 2500) {
    const samples = [];
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      await new Promise((r) => setTimeout(r, 100));
      samples.push(this.raw);
    }
    samples.sort((a, b) => a - b);
    const p80 = samples[Math.floor(samples.length * 0.8)] || 1;
    this.noise = Math.min(Math.max(p80, 0.5), 12);
    return this.noise;
  }

  loop() {
    if (!this.running) return;
    try {
      this.step();
    } catch (e) {
      console.warn('motion step failed, using fallback', e);
      this.useCV = false;
    }
    setTimeout(() => this.loop(), 66); // ~15 fps
  }

  step() {
    // Mirror so it feels like a mirror.
    this.wctx.save();
    this.wctx.scale(-1, 1);
    this.wctx.drawImage(this.video, -W, 0, W, H);
    this.wctx.restore();
    const img = this.wctx.getImageData(0, 0, W, H);

    let changed = 0;
    let mask = null;
    if (this.useCV) {
      const cv = window.cv;
      const src = cv.matFromImageData(img);
      const gray = new cv.Mat();
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
      if (this.cvPrev) {
        const diff = new cv.Mat();
        cv.absdiff(gray, this.cvPrev, diff);
        cv.threshold(diff, diff, 25, 255, cv.THRESH_BINARY);
        cv.dilate(diff, diff, cv.Mat.ones(3, 3, cv.CV_8U));
        if (this.shrink) changed = this.countInBox(diff.data);
        else changed = cv.countNonZero(diff);
        // contours -> motion boxes for the overlay
        const contours = new cv.MatVector();
        const hier = new cv.Mat();
        cv.findContours(diff, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
        const boxes = [];
        for (let i = 0; i < contours.size(); i++) {
          const c = contours.get(i);
          if (cv.contourArea(c) > 30) {
            const r = cv.boundingRect(c);
            boxes.push(r);
          }
          c.delete();
        }
        boxes.sort((a, b) => b.width * b.height - a.width * a.height);
        this.boxes = boxes.slice(0, 6);
        contours.delete();
        hier.delete();
        diff.delete();
        this.cvPrev.delete();
      }
      this.cvPrev = gray;
      src.delete();
    } else {
      const d = img.data;
      const g = new Uint8Array(W * H);
      for (let i = 0, j = 0; i < d.length; i += 4, j++) {
        g[j] = (d[i] * 3 + d[i + 1] * 6 + d[i + 2]) / 10;
      }
      if (this.prevGray) {
        mask = new Uint8Array(W * H);
        for (let j = 0; j < g.length; j++) {
          if (Math.abs(g[j] - this.prevGray[j]) > 25) mask[j] = 255;
        }
        changed = this.shrink ? this.countInBox(mask) : mask.reduce((a, v) => a + (v ? 1 : 0), 0);
        changed *= 1.35; // no dilate here: match the OpenCV path's reading
        this.boxes = [];
      }
      this.prevGray = g;
    }

    const area = this.shrink ? this.shrink.w * W * this.shrink.h * H : W * H;
    const frac = (changed / area) * 100;
    this.shake = !this.shrink && frac > 85;
    // smooth raw
    this.raw = this.raw * 0.5 + frac * 0.5;
    // calibrated 0..100: subtract noise + small deadzone, ~16% changed = 100
    // (tuned on fake webcam clips: still <5, arm wave ~55, full thrash 100)
    const m = Math.max(0, this.raw - this.noise * 1.3 - 0.8) * (100 / 15);
    this.motion = this.shake ? 0 : Math.min(100, m);
    this.drawOverlay();
  }

  countInBox(data) {
    const b = this.shrink;
    const x0 = Math.floor(b.x * W);
    const y0 = Math.floor(b.y * H);
    const x1 = Math.floor((b.x + b.w) * W);
    const y1 = Math.floor((b.y + b.h) * H);
    let n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (data[y * W + x]) n++;
    return n;
  }

  drawOverlay() {
    const o = this.overlay;
    if (!o) return;
    const ctx = o.getContext('2d');
    const sx = o.width / W;
    const sy = o.height / H;
    ctx.clearRect(0, 0, o.width, o.height);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,255,170,0.9)';
    ctx.shadowColor = 'rgba(0,255,170,0.8)';
    ctx.shadowBlur = 8;
    for (const r of this.boxes) ctx.strokeRect(r.x * sx, r.y * sy, r.width * sx, r.height * sy);
    ctx.shadowBlur = 0;
    if (this.shrink) {
      const b = this.shrink;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, o.width, o.height);
      ctx.clearRect(b.x * o.width, b.y * o.height, b.w * o.width, b.h * o.height);
      ctx.strokeStyle = '#ff3b6b';
      ctx.lineWidth = 3;
      ctx.strokeRect(b.x * o.width, b.y * o.height, b.w * o.width, b.h * o.height);
    }
  }
}
