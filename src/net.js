// Networking: Supabase Realtime (Broadcast + Presence + Postgres Changes) and
// the runs table. If Supabase env vars are missing, falls back to a local mode
// (BroadcastChannel + localStorage) so the game still works in one browser.

import { createClient } from '@supabase/supabase-js';

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const online = Boolean(URL && KEY);
export const supabase = online
  ? createClient(URL, KEY, { realtime: { params: { eventsPerSecond: 20 } } })
  : null;

const LS_KEY = 'mrtrun_runs_v1';

// ---------- Lobby channel ----------
// events: tick {id,name,color,tier,progress,station,speed,charges}
//         sabo {from,fromName,target,type}
//         finish {id}
//         battle {tier,startAt}
export function joinLobby({ presence, onEvent, onPresence }) {
  if (online) {
    const ch = supabase.channel('lobby', {
      config: { broadcast: { self: false }, presence: { key: presence?.id || 'screen-' + Math.random() } },
    });
    for (const ev of ['tick', 'sabo', 'finish', 'battle']) {
      ch.on('broadcast', { event: ev }, ({ payload }) => onEvent?.(ev, payload));
    }
    ch.on('presence', { event: 'sync' }, () => onPresence?.(ch.presenceState()));
    ch.subscribe(async (status) => {
      if (status === 'SUBSCRIBED' && presence) await ch.track(presence);
    });
    return {
      send: (event, payload) => ch.send({ type: 'broadcast', event, payload }),
      track: (p) => ch.track(p),
      leave: () => supabase.removeChannel(ch),
    };
  }
  const bc = new BroadcastChannel('mrtrun_lobby');
  bc.onmessage = (e) => onEvent?.(e.data.event, e.data.payload);
  return {
    send: (event, payload) => bc.postMessage({ event, payload }),
    track: () => {},
    leave: () => bc.close(),
  };
}

// ---------- Runs ----------
export async function saveRun(run) {
  if (online) {
    const { error } = await supabase.from('runs').insert(run);
    if (error) console.error('saveRun', error);
    return;
  }
  const all = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
  all.push({ ...run, created_at: new Date().toISOString() });
  localStorage.setItem(LS_KEY, JSON.stringify(all));
  new BroadcastChannel('mrtrun_runs').postMessage('new');
}

// Best time per player name for a tier (optionally today only).
export async function leaderboard(tier, { today = false, limit = 10 } = {}) {
  let rows;
  if (online) {
    let q = supabase
      .from('runs')
      .select('player_name,color,tier,time_ms,obstacles_cleared,created_at')
      .eq('tier', tier)
      .order('time_ms', { ascending: true })
      .limit(300);
    if (today) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      q = q.gte('created_at', d.toISOString());
    }
    const { data, error } = await q;
    if (error) console.error('leaderboard', error);
    rows = data || [];
  } else {
    rows = JSON.parse(localStorage.getItem(LS_KEY) || '[]')
      .filter((r) => r.tier === tier)
      .sort((a, b) => a.time_ms - b.time_ms);
  }
  const seen = new Set();
  const best = [];
  for (const r of rows) {
    const k = r.player_name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    best.push(r);
    if (best.length >= limit) break;
  }
  return best;
}

export async function personalBest(name, tier) {
  const rows = await leaderboard(tier, { limit: 300 });
  return rows.find((r) => r.player_name.toLowerCase() === name.toLowerCase()) || null;
}

export function onNewRun(cb) {
  if (online) {
    const ch = supabase
      .channel('runs-changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'runs' }, (p) => cb(p.new))
      .subscribe();
    return () => supabase.removeChannel(ch);
  }
  const bc = new BroadcastChannel('mrtrun_runs');
  bc.onmessage = () => cb(null);
  return () => bc.close();
}
