const express = require('express');
const http = require('http');
const os = require('os');
const path = require('path');
const { Server } = require('socket.io');
const QRCode = require('qrcode');

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/host', (req, res) => res.sendFile(path.join(__dirname, 'public', 'host.html')));
app.get('/controller', (req, res) => res.sendFile(path.join(__dirname, 'public', 'controller.html')));

// ── LAN address ──
// Phones can't reach "localhost", so when the host page was opened via
// localhost/127.0.0.1 the QR code uses this machine's LAN IPv4 instead.
function lanIp() {
  const nets = os.networkInterfaces();
  const found = [];
  for (const name of Object.keys(nets)) {
    for (const n of nets[name] || []) {
      if ((n.family === 'IPv4' || n.family === 4) && !n.internal) found.push(n.address);
    }
  }
  const pref = found.find(a => /^192\.168\./.test(a)) ||
               found.find(a => /^10\./.test(a)) ||
               found.find(a => /^172\.(1[6-9]|2\d|3[01])\./.test(a)) ||
               found[0];
  return pref || 'localhost';
}

function joinBase(hostHeader) {
  const h = (hostHeader || '').toLowerCase();
  const hostname = h.replace(/:\d+$/, '');
  if (!h || hostname === 'localhost' || hostname.startsWith('127.') || hostname === '[::1]') {
    return `http://${lanIp()}:${PORT}`;
  }
  return `http://${h}`;
}

async function qrSvgFor(url) {
  return QRCode.toString(url, {
    type: 'svg',
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#1b1b1a', light: '#ecebe6' }
  });
}

// ── Rooms ──
// rooms[code] = {
//   hostSocketId,
//   players:   { A: socketId|null, B: socketId|null },
//   clientIds: { A: string|null,   B: string|null },   // which phone owns the slot
//   ready:     { A: bool, B: bool },
//   started:   bool,                                   // phones are on the joystick
//   ui:        last host_ui payload (re-sent to phones that reconnect)
// }
const rooms = {};

function genCode() {
  let code;
  do { code = Math.floor(100000 + Math.random() * 900000).toString(); } while (rooms[code]);
  return code;
}

function lobbyPayload(room) {
  return { A: !!room.players.A, B: !!room.players.B, readyA: room.ready.A, readyB: room.ready.B };
}
function broadcastLobby(code) {
  const room = rooms[code];
  if (!room) return;
  io.to(code).emit('game_event', { event: 'lobby_ready_update', data: lobbyPayload(room) });
}

function shortUA(socket) {
  const ua = socket.handshake.headers['user-agent'] || '?';
  return ua.length > 90 ? ua.slice(0, 90) + '…' : ua;
}

// Bind a phone to a slot. One phone (clientId) = one slot, one socket = one slot.
function bindPhone(socket, code, clientId, hintSlot) {
  const room = rooms[code];
  if (!room) { socket.emit('join_error', 'Room not found'); return; }
  clientId = typeof clientId === 'string' && clientId ? clientId.slice(0, 64) : null;

  // This socket already holds a slot here → just confirm it.
  if (socket.data.code === code && socket.data.slot && room.players[socket.data.slot] === socket.id) {
    sendJoined(socket, room, socket.data.slot);
    return;
  }

  let slot = null;

  // 1) Same phone re-opening the link keeps its slot.
  if (clientId) {
    if (room.clientIds.A === clientId) slot = 'A';
    else if (room.clientIds.B === clientId) slot = 'B';
  }
  // 2) Reconnect hint — only if the slot is free and not owned by another phone.
  if (!slot && hintSlot && (hintSlot === 'A' || hintSlot === 'B')) {
    if (!room.players[hintSlot] && !room.clientIds[hintSlot]) slot = hintSlot;
  }
  // 3) A never-claimed slot.
  if (!slot) {
    if (!room.players.A && !room.clientIds.A) slot = 'A';
    else if (!room.players.B && !room.clientIds.B) slot = 'B';
  }
  // 4) A slot whose phone has gone away.
  if (!slot) {
    if (!room.players.A) slot = 'A';
    else if (!room.players.B) slot = 'B';
  }
  if (!slot) { socket.emit('join_error', 'Room is full'); return; }

  // Kick the previous tab of the same phone off this slot.
  const prev = room.players[slot];
  if (prev && prev !== socket.id) {
    const old = io.sockets.sockets.get(prev);
    if (old) {
      old.data.slot = null;
      old.data.code = null;
      old.leave(code);
      old.emit('replaced');
    }
  }

  // A socket never holds two slots.
  const other = slot === 'A' ? 'B' : 'A';
  if (room.players[other] === socket.id) room.players[other] = null;

  if (room.clientIds[slot] !== clientId) room.ready[slot] = false;
  room.players[slot] = socket.id;
  room.clientIds[slot] = clientId;
  socket.data.code = code;
  socket.data.slot = slot;
  socket.join(code);

  console.log(`[${code}] phone → ${slot}  (${shortUA(socket)})`);
  sendJoined(socket, room, slot);
  io.to(code).emit('player_joined', { slot, players: { A: !!room.players.A, B: !!room.players.B } });
  broadcastLobby(code);
}

function sendJoined(socket, room, slot) {
  socket.emit('joined', { slot, code: socket.data.code, started: room.started, ready: room.ready[slot] });
  if (room.started) {
    socket.emit('game_start');
    if (room.ui) socket.emit('host_ui', room.ui);
  }
}

io.on('connection', (socket) => {
  socket.data.code = null;
  socket.data.slot = null;
  socket.data.isHost = false;

  socket.on('ping_check', (cb) => { if (typeof cb === 'function') cb(); });

  // ── HOST ──
  socket.on('create_game', async () => {
    const code = genCode();
    rooms[code] = {
      hostSocketId: socket.id,
      players: { A: null, B: null },
      clientIds: { A: null, B: null },
      ready: { A: false, B: false },
      started: false,
      ui: null
    };
    socket.data.code = code;
    socket.data.isHost = true;
    socket.join(code);
    const joinUrl = `${joinBase(socket.handshake.headers.host)}/controller?code=${code}`;
    let qrSvg = '';
    try { qrSvg = await qrSvgFor(joinUrl); } catch (e) { console.warn('QR failed', e.message); }
    console.log(`[${code}] room created — join: ${joinUrl}`);
    socket.emit('game_created', { code, joinUrl, qrSvg });
  });

  // Host mirrors its on-screen menu / status to the phones.
  socket.on('host_ui', (ui) => {
    const room = rooms[socket.data.code];
    if (!room || room.hostSocketId !== socket.id) return;
    room.ui = ui;
    socket.to(socket.data.code).emit('host_ui', ui);
  });

  socket.on('host_back_to_lobby', () => {
    const code = socket.data.code;
    const room = rooms[code];
    if (!room || room.hostSocketId !== socket.id) return;
    room.started = false;
    room.ready = { A: false, B: false };
    room.ui = null;
    io.to(code).emit('back_to_lobby');
    broadcastLobby(code);
  });

  // ── PHONE ──
  socket.on('join_game', ({ code, clientId } = {}) => bindPhone(socket, String(code || ''), clientId, null));
  socket.on('rejoin_game', ({ code, slot, clientId } = {}) => bindPhone(socket, String(code || ''), clientId, slot));

  socket.on('player_ready', () => {
    const code = socket.data.code;
    const room = rooms[code];
    const slot = socket.data.slot;
    if (!room || !slot || room.players[slot] !== socket.id) return;
    room.ready[slot] = true;
    broadcastLobby(code);
    if (!room.started && room.players.A && room.players.B && room.ready.A && room.ready.B) {
      room.started = true;
      io.to(code).emit('game_start');
    }
  });

  socket.on('ctrl_input', ({ dir, pressed } = {}) => {
    const room = rooms[socket.data.code];
    const slot = socket.data.slot;
    if (!room || !slot || room.players[slot] !== socket.id) return;
    if (!['up', 'down', 'left', 'right'].includes(dir)) return;
    io.to(room.hostSocketId).emit('ctrl_input', { slot, dir, pressed: !!pressed });
  });

  socket.on('ctrl_fire', () => {
    const room = rooms[socket.data.code];
    const slot = socket.data.slot;
    if (!room || !slot || room.players[slot] !== socket.id) return;
    io.to(room.hostSocketId).emit('ctrl_fire', { slot });
  });

  socket.on('disconnect', () => {
    const code = socket.data.code;
    const room = code && rooms[code];
    if (!room) return;

    if (socket.data.isHost && room.hostSocketId === socket.id) {
      io.to(code).emit('host_disconnected');
      delete rooms[code];
      return;
    }
    const slot = socket.data.slot;
    if (slot && room.players[slot] === socket.id) {
      room.players[slot] = null;
      if (!room.started) room.ready[slot] = false;
      io.to(code).emit('player_left', { slot });
      broadcastLobby(code);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Math Duel server: http://localhost:${PORT}`);
  console.log(`Phones join via:  http://${lanIp()}:${PORT}`);
});
