// Sturmfall-Server (Cloudflare Worker + Durable Object, läuft im Gratis-Tarif).
// Liefert das Spiel aus und verbindet die Spieler: ein Raum-Code = ein Durable Object.
// Der Server merkt sich den Zustand (presence) jedes Spielers und schickt Änderungen an alle anderen.
// Kein NAT-Ärger mehr: jeder Spieler baut nur eine normale WebSocket-Verbindung zum Server auf.

const GRACE_MS = 10000; // so lange darf ein Spieler weg sein (z. B. iPad kurz im Hintergrund), ohne den Raum zu verlassen
const MAX_PLAYERS = 40;

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.members = new Map(); // id -> { ws, p (presence), t (Beitrittszeit), gone (Timer) }
    this.host = null;
  }

  async fetch(req) {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('WebSocket erwartet', { status: 426 });
    const url = new URL(req.url);
    const id = (url.searchParams.get('id') || '').replace(/[^\w-]/g, '').slice(0, 64) || crypto.randomUUID();
    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    server.accept();
    this.join(id, server);
    return new Response(null, { status: 101, webSocket: client });
  }

  send(ws, msg) {
    try { ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); } catch (_) {}
  }

  broadcast(msg, except) {
    const s = JSON.stringify(msg);
    for (const [id, m] of this.members) if (id !== except && m.ws) this.send(m.ws, s);
  }

  join(id, ws) {
    let m = this.members.get(id);
    if (m) {
      // Wiederverbinden: gleicher Spieler, neue Leitung
      clearTimeout(m.gone);
      m.gone = null;
      if (m.ws && m.ws !== ws) {
        const old = m.ws;
        m.ws = null;
        try { old.close(4000, 'replaced'); } catch (_) {}
      }
      m.ws = ws;
    } else {
      if (this.members.size >= MAX_PLAYERS) {
        this.send(ws, { t: 'roomfull' });
        try { ws.close(4001, 'room full'); } catch (_) {}
        return;
      }
      m = { ws, p: {}, t: Date.now(), gone: null };
      this.members.set(id, m);
    }
    if (!this.host || !this.members.has(this.host)) this.host = id;

    const full = [];
    for (const [mid, mm] of this.members) full.push([mid, mm.p]);
    this.send(ws, { t: 'hello', me: id, host: this.host, full });

    ws.addEventListener('message', ev => this.onMessage(id, ws, ev.data));
    // Schließen bestätigen, sonst wartet der Browser bis zum Timeout, bevor er neu verbindet
    ws.addEventListener('close', () => { try { ws.close(1000, 'bye'); } catch (_) {} this.lost(id, ws); });
    ws.addEventListener('error', () => this.lost(id, ws));
  }

  onMessage(id, ws, data) {
    const m = this.members.get(id);
    if (!m || m.ws !== ws || typeof data !== 'string' || data.length > 256000) return;
    let msg;
    try { msg = JSON.parse(data); } catch (_) { return; }
    if (msg.t === 'p' && msg.d && typeof msg.d === 'object') {
      for (const k in msg.d) {
        if (msg.d[k] === null) delete m.p[k];
        else m.p[k] = msg.d[k];
      }
      this.broadcast({ t: 'p', f: id, d: msg.d }, id);
    } else if (msg.t === 'bye') {
      this.remove(id);
    } else if (msg.t === 'ping') {
      this.send(ws, { t: 'pong' });
    }
  }

  // Leitung weg: kurz warten, ob der Spieler zurückkommt
  lost(id, ws) {
    const m = this.members.get(id);
    if (!m || m.ws !== ws) return;
    m.ws = null;
    clearTimeout(m.gone);
    m.gone = setTimeout(() => { if (!m.ws) this.remove(id); }, GRACE_MS);
  }

  remove(id) {
    const m = this.members.get(id);
    if (!m) return;
    clearTimeout(m.gone);
    this.members.delete(id);
    if (m.ws) { try { m.ws.close(1000, 'bye'); } catch (_) {} }
    this.broadcast({ t: 'left', id });
    if (this.host === id) {
      // Host weg: wer am längsten im Raum ist, übernimmt
      this.host = null;
      let best = null;
      for (const [mid, mm] of this.members) if (mm.ws && (!best || mm.t < best.t)) best = { id: mid, t: mm.t };
      if (best) {
        this.host = best.id;
        this.broadcast({ t: 'host', id: this.host });
      }
    }
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const room = url.pathname.match(/^\/room\/([a-z0-9]{1,24})\/?$/);
    if (room) return env.ROOMS.get(env.ROOMS.idFromName(room[1])).fetch(req);
    if (url.pathname === '/health') return new Response('ok');
    return env.ASSETS.fetch(req);
  }
};
