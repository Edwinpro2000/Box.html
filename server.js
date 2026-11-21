'use strict';
/* KartGame: servidor de multijugador (sin dependencias).
   Sirve el juego (carpeta public/) y reenvía posiciones entre jugadores por WebSocket. */
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), os = require('os');
const PORT = +process.env.PORT || 3000, ROOT = path.join(__dirname, 'public'), MAX = 8;
const TYPES = {'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.ico':'image/x-icon','.json':'application/json'};

const server = http.createServer((req, res) => {
  let u;
  try { u = decodeURIComponent(req.url.split('?')[0]); } catch (e) { res.writeHead(400); res.end(); return; }
  if (u === '/health') { res.end('ok'); return; }
  if (u === '/') u = '/index.html';
  const f = path.normalize(path.join(ROOT, u));
  if (!f.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); res.end('No encontrado'); return; }
    res.writeHead(200, {'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache'});
    res.end(d);
  });
});

/* ---- WebSocket mínimo (RFC 6455) ---- */
class Conn {
  constructor(sock) {
    this.sock = sock; this.buf = Buffer.alloc(0); this.frag = []; this.alive = true;
    this.onmessage = () => {}; this.onclose = () => {};
    sock.setNoDelay(true);
    sock.on('data', d => {
      this.buf = Buffer.concat([this.buf, d]);
      if (this.buf.length > 262144) { this.close(); return; }
      this.parse();
    });
    sock.on('close', () => this.end());
    sock.on('error', () => this.end());
  }
  parse() {
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = !!(b[0] & 128), op = b[0] & 15, masked = !!(b[1] & 128);
      let len = b[1] & 127, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = b.readUInt32BE(6); off = 10; }
      if (len > 65536) { this.close(); return; }
      const need = off + (masked ? 4 : 0) + len;
      if (b.length < need) return;
      let p = b.slice(off + (masked ? 4 : 0), need);
      if (masked) { const m = b.slice(off, off + 4); p = Buffer.from(p); for (let i = 0; i < p.length; i++) p[i] ^= m[i & 3]; }
      this.buf = b.slice(need);
      if (op === 8) { this.close(); return; }
      if (op === 9) { this.frame(10, p); continue; }
      if (op === 10) continue;
      if (op === 1 || op === 0) {
        this.frag.push(p);
        if (fin) { const s = Buffer.concat(this.frag).toString('utf8'); this.frag = []; this.onmessage(s); }
      }
    }
  }
  frame(op, p) {
    if (!this.alive) return;
    const n = p.length; let h;
    if (n < 126) h = Buffer.from([128 | op, n]);
    else if (n < 65536) { h = Buffer.alloc(4); h[0] = 128 | op; h[1] = 126; h.writeUInt16BE(n, 2); }
    else { h = Buffer.alloc(10); h[0] = 128 | op; h[1] = 127; h.writeUInt32BE(n, 6); }
    this.sock.write(Buffer.concat([h, p]));
  }
  send(s) { this.frame(1, Buffer.from(s)); }
  close() { if (this.alive) { try { this.frame(8, Buffer.alloc(0)); } catch (e) {} this.sock.end(); } this.end(); }
  end() { if (!this.alive) return; this.alive = false; this.onclose(); }
}

/* ---- salas ---- */
const rooms = new Map();
function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let c;
  do { c = ''; for (let i = 0; i < 4; i++) c += A[Math.random() * A.length | 0]; } while (rooms.has(c));
  return c;
}
function lanIPs() {
  try {
    const out = [];
    for (const list of Object.values(os.networkInterfaces()))
      for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
    return out;
  } catch (e) { return []; }
}
const plist = r => [...r.players.values()].map(p => ({slot: p.slot, name: p.name}));
function bcast(r, msg, except) {
  const s = JSON.stringify(msg);
  for (const p of r.players.values()) if (p !== except && p.conn.alive) p.conn.send(s);
}
const sendPlayers = r => bcast(r, {t: 'players', players: plist(r), host: r.host});

server.on('upgrade', (req, sock) => {
  if (req.url.split('?')[0] !== '/ws' || !req.headers['sec-websocket-key']) { sock.destroy(); return; }
  const acc = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + acc + '\r\n\r\n');
  const c = new Conn(sock);
  let me = null, room = null;
  const err = m => c.send(JSON.stringify({t: 'err', m}));

  c.onmessage = s => {
    let m; try { m = JSON.parse(s); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    if (m.t === 'create' || m.t === 'join') {
      if (me) return;
      const name = String(m.name || 'Jugador').replace(/[<>]/g, '').slice(0, 12) || 'Jugador';
      let r;
      if (m.t === 'create') { r = {code: newCode(), players: new Map(), host: -1, started: false}; }
      else {
        r = rooms.get(String(m.room || '').toUpperCase().trim());
        if (!r) return err('Sala no encontrada');
        if (r.started) return err('La carrera ya empezó');
        if (r.players.size >= MAX) return err('La sala está llena');
      }
      let slot = 0; while (r.players.has(slot)) slot++;
      if (m.t === 'create') rooms.set(r.code, r);
      room = r; me = {conn: c, slot, name};
      r.players.set(slot, me);
      if (r.host < 0) r.host = slot;
      c.send(JSON.stringify({t: 'joined', room: r.code, slot, host: r.host, players: plist(r), lan: lanIPs(), port: PORT}));
      sendPlayers(r);
      return;
    }
    if (!me || !room) return;
    if (m.t === 's') {
      if (Array.isArray(m.d) && m.d.length <= 9) bcast(room, {t: 's', d: m.d}, me);
    } else if (m.t === 'start') {
      if (room.host !== me.slot) return;
      if (room.players.size < 2) return err('Faltan jugadores: se necesitan al menos 2');
      room.started = true; bcast(room, {t: 'start', players: plist(room)});
    } else if (m.t === 'again') {
      if (room.host !== me.slot) return;
      room.started = false; bcast(room, {t: 'lobby'}); sendPlayers(room);
    }
  };
  c.onclose = () => {
    if (!room || !me) return;
    room.players.delete(me.slot);
    if (room.players.size === 0) { rooms.delete(room.code); return; }
    if (room.host === me.slot) room.host = Math.min(...room.players.keys());
    sendPlayers(room);
  };
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('KartGame listo en el puerto ' + PORT);
  console.log('  En este dispositivo:  http://localhost:' + PORT);
  const ips = lanIPs();
  if (ips.length) ips.forEach(ip => console.log('  Misma red WiFi:       http://' + ip + ':' + PORT));
  else console.log('  (No pude leer tu IP. Búscala en Ajustes > WiFi y usa http://TU-IP:' + PORT + ')');
});
