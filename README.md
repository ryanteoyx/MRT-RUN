# MRT RUN

Thrash in front of your webcam to drive a train along real Singapore MRT routes. OpenCV.js measures your motion in the browser; Supabase Realtime streams everyone's race to a live big-screen leaderboard.

Built for the ClaudeSG x Supabase hackathon.

## Play

- `/`: player view (laptop with a webcam)
- `/screen`: big-screen leaderboard, live map of everyone racing, QR code, battle starter

## How it works

| Piece | What it does |
| --- | --- |
| OpenCV.js (`src/motion.js`) | Webcam frame differencing: greyscale, GaussianBlur, absdiff, threshold, dilate, countNonZero, plus findContours to draw motion boxes. Calibrates the room's noise first. Falls back to plain canvas maths if OpenCV can't load. |
| Routes (`src/routes.js`) | Three lines with real station coordinates: Easy (Marina South Pier to Orchard), Medium (Tanah Merah to Raffles Place), Hard (Yishun to Marina South Pier). |
| Map (`src/map.js`) | 2D canvas renderer: following camera, glowing track, stations, obstacles, rival and personal-best ghost trains, minimap. |
| Game (`src/play.js`) | Motion sets train speed; combos (x1.25 / x1.5 / x2) reward sustained effort. Random obstacles: Signal Fault (thrash), Doors Closing (freeze), Crowd Surge (keep moving). Clearing one gives a boost and a sabotage charge. |
| Sabotage | Two types fired at the rival just ahead: Freeze (train stops 3 s) and Shrink (only a small centre box of their camera counts for 5 s). 6 s immunity after being hit. |
| Supabase Realtime | Broadcast for live ticks, sabotage and battle start; Presence for who's online; Postgres Changes on `runs` to refresh the leaderboard. |
| Supabase Postgres | `runs` table (best time per player per tier), RLS: anyone can read and insert, nobody can edit or delete. |

## Run locally

```
npm install
cp .env.example .env   # add your Supabase URL and publishable key
npm run dev
```

Without Supabase env vars the game runs in local mode (one browser, localStorage leaderboard).
