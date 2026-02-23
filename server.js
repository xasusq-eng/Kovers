const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = process.env.PORT || 4173;
const DATA_FILE = path.join(__dirname, 'kovers-data.local.json');

function nowIso() {
  return new Date().toISOString();
}

function id() {
  return crypto.randomUUID();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const digest = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${digest}`;
}

function verifyPassword(password, packed) {
  const [salt, saved] = String(packed || '').split(':');
  if (!salt || !saved) return false;
  const digest = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(saved, 'hex'), Buffer.from(digest, 'hex'));
}

function createInitialData() {
  return { users: [], sessions: [], rooms: [], messages: [], calls: [] };
}

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    const seed = createInitialData();
    fs.writeFileSync(DATA_FILE, JSON.stringify(seed, null, 2));
    return seed;
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

let db = loadData();

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (chunk) => {
      buf += chunk;
      if (buf.length > 1024 * 1024) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!buf) return resolve({});
      try {
        resolve(JSON.parse(buf));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function getSession(req) {
  const token = req.headers['x-kovers-token'];
  if (!token) return null;
  return db.sessions.find((s) => s.token === token) || null;
}

function authUser(req) {
  const session = getSession(req);
  if (!session) return null;
  return db.users.find((u) => u.id === session.userId) || null;
}

function serializeRoom(room, currentUserId) {
  const members = room.members.map((idVal) => db.users.find((u) => u.id === idVal)?.username || 'unknown');
  let title = room.name;
  if (room.type === 'dm') {
    const other = room.members.find((m) => m !== currentUserId);
    title = db.users.find((u) => u.id === other)?.username || room.name || 'Диалог';
  }
  return { ...room, title, members };
}

function serializeMessage(m) {
  return {
    ...m,
    author: db.users.find((u) => u.id === m.authorId)?.username || 'unknown'
  };
}

function serveStatic(res, pathname) {
  const fileMap = {
    '/': 'index.html',
    '/index.html': 'index.html',
    '/script.js': 'script.js',
    '/styles.css': 'styles.css'
  };
  const file = fileMap[pathname];
  if (!file) return false;
  const filePath = path.join(__dirname, file);
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return true;
  }
  const ext = path.extname(filePath);
  const type = ext === '.html' ? 'text/html; charset=utf-8' : ext === '.css' ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8';
  const content = fs.readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': content.length });
  res.end(content);
  return true;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const { pathname, searchParams } = url;

    if (serveStatic(res, pathname)) return;

    if (req.method === 'POST' && pathname === '/api/auth/register') {
      const body = await parseBody(req);
      const username = String(body.username || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (!/^[a-z0-9_]{3,24}$/.test(username)) return sendJson(res, 400, { error: 'Логин: 3-24, a-z, 0-9, _' });
      if (password.length < 6) return sendJson(res, 400, { error: 'Пароль минимум 6 символов' });
      if (db.users.some((u) => u.username === username)) return sendJson(res, 409, { error: 'Логин уже занят' });
      const user = { id: id(), username, passwordHash: hashPassword(password), createdAt: nowIso() };
      db.users.push(user);
      saveData();
      return sendJson(res, 201, { ok: true });
    }

    if (req.method === 'POST' && pathname === '/api/auth/login') {
      const body = await parseBody(req);
      const username = String(body.username || '').trim().toLowerCase();
      const password = String(body.password || '');
      const user = db.users.find((u) => u.username === username);
      if (!user || !verifyPassword(password, user.passwordHash)) return sendJson(res, 401, { error: 'Неверный логин/пароль' });
      const token = crypto.randomBytes(24).toString('hex');
      db.sessions = db.sessions.filter((s) => s.userId !== user.id);
      db.sessions.push({ token, userId: user.id, createdAt: nowIso() });
      saveData();
      return sendJson(res, 200, { token, username: user.username });
    }

    if (pathname.startsWith('/api/')) {
      const user = authUser(req);
      if (!user) return sendJson(res, 401, { error: 'Требуется авторизация' });

      if (req.method === 'POST' && pathname === '/api/auth/logout') {
        const session = getSession(req);
        db.sessions = db.sessions.filter((s) => s.token !== session.token);
        saveData();
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === 'GET' && pathname === '/api/me') {
        return sendJson(res, 200, { id: user.id, username: user.username });
      }

      if (req.method === 'GET' && pathname === '/api/users/search') {
        const q = String(searchParams.get('q') || '').trim().toLowerCase();
        const users = db.users
          .filter((u) => u.username.includes(q) && u.id !== user.id)
          .slice(0, 10)
          .map((u) => ({ id: u.id, username: u.username }));
        return sendJson(res, 200, { users });
      }

      if (req.method === 'GET' && pathname === '/api/rooms') {
        const rooms = db.rooms.filter((r) => r.members.includes(user.id)).map((r) => serializeRoom(r, user.id));
        return sendJson(res, 200, { rooms });
      }

      if (req.method === 'POST' && pathname === '/api/rooms') {
        const body = await parseBody(req);
        const name = String(body.name || '').trim().slice(0, 40);
        if (!name) return sendJson(res, 400, { error: 'Название комнаты обязательно' });
        const membersRaw = Array.isArray(body.members) ? body.members : [];
        const memberIds = [...new Set([user.id, ...membersRaw.map((uName) => db.users.find((u) => u.username === String(uName).toLowerCase())?.id).filter(Boolean)])];
        const room = { id: id(), type: 'group', name, members: memberIds, createdBy: user.id, createdAt: nowIso() };
        db.rooms.push(room);
        saveData();
        return sendJson(res, 201, { room: serializeRoom(room, user.id) });
      }

      if (req.method === 'POST' && pathname === '/api/dm') {
        const body = await parseBody(req);
        const username = String(body.username || '').trim().toLowerCase();
        const other = db.users.find((u) => u.username === username);
        if (!other) return sendJson(res, 404, { error: 'Пользователь не найден' });
        if (other.id === user.id) return sendJson(res, 400, { error: 'Нельзя создать DM с собой' });

        let room = db.rooms.find((r) => r.type === 'dm' && r.members.length === 2 && r.members.includes(user.id) && r.members.includes(other.id));
        if (!room) {
          room = { id: id(), type: 'dm', name: '', members: [user.id, other.id], createdBy: user.id, createdAt: nowIso() };
          db.rooms.push(room);
          saveData();
        }
        return sendJson(res, 201, { room: serializeRoom(room, user.id) });
      }

      if (req.method === 'GET' && pathname === '/api/messages') {
        const roomId = String(searchParams.get('roomId') || '');
        const since = String(searchParams.get('since') || '');
        const room = db.rooms.find((r) => r.id === roomId);
        if (!room || !room.members.includes(user.id)) return sendJson(res, 404, { error: 'Комната не найдена' });
        let messages = db.messages.filter((m) => m.roomId === roomId);
        if (since) messages = messages.filter((m) => m.createdAt > since);
        return sendJson(res, 200, { messages: messages.slice(-200).map(serializeMessage) });
      }

      if (req.method === 'POST' && pathname === '/api/messages') {
        const body = await parseBody(req);
        const roomId = String(body.roomId || '');
        const text = String(body.text || '').trim().slice(0, 1500);
        const room = db.rooms.find((r) => r.id === roomId);
        if (!room || !room.members.includes(user.id)) return sendJson(res, 404, { error: 'Комната не найдена' });
        if (!text) return sendJson(res, 400, { error: 'Пустое сообщение' });
        const message = { id: id(), roomId, authorId: user.id, text, createdAt: nowIso() };
        db.messages.push(message);
        saveData();
        return sendJson(res, 201, { message: serializeMessage(message) });
      }

      if (req.method === 'GET' && pathname === '/api/calls') {
        const roomId = String(searchParams.get('roomId') || '');
        const room = db.rooms.find((r) => r.id === roomId);
        if (!room || !room.members.includes(user.id)) return sendJson(res, 404, { error: 'Комната не найдена' });
        const calls = db.calls.filter((c) => c.roomId === roomId && c.status === 'active');
        return sendJson(res, 200, { calls });
      }

      if (req.method === 'POST' && pathname === '/api/calls/start') {
        const body = await parseBody(req);
        const roomId = String(body.roomId || '');
        const type = body.type === 'video' ? 'video' : 'voice';
        const room = db.rooms.find((r) => r.id === roomId);
        if (!room || !room.members.includes(user.id)) return sendJson(res, 404, { error: 'Комната не найдена' });
        const existing = db.calls.find((c) => c.roomId === roomId && c.status === 'active');
        if (existing) return sendJson(res, 200, { call: existing });
        const call = { id: id(), roomId, type, status: 'active', participants: [user.username], startedAt: nowIso(), endedAt: null };
        db.calls.push(call);
        saveData();
        return sendJson(res, 201, { call });
      }

      if (req.method === 'POST' && pathname === '/api/calls/join') {
        const body = await parseBody(req);
        const callId = String(body.callId || '');
        const call = db.calls.find((c) => c.id === callId && c.status === 'active');
        if (!call) return sendJson(res, 404, { error: 'Звонок не найден' });
        const room = db.rooms.find((r) => r.id === call.roomId);
        if (!room || !room.members.includes(user.id)) return sendJson(res, 403, { error: 'Нет доступа' });
        if (!call.participants.includes(user.username)) call.participants.push(user.username);
        saveData();
        return sendJson(res, 200, { call });
      }

      if (req.method === 'POST' && pathname === '/api/calls/end') {
        const body = await parseBody(req);
        const callId = String(body.callId || '');
        const call = db.calls.find((c) => c.id === callId && c.status === 'active');
        if (!call) return sendJson(res, 404, { error: 'Звонок не найден' });
        const room = db.rooms.find((r) => r.id === call.roomId);
        if (!room || !room.members.includes(user.id)) return sendJson(res, 403, { error: 'Нет доступа' });
        call.status = 'ended';
        call.endedAt = nowIso();
        saveData();
        return sendJson(res, 200, { call });
      }

      return sendJson(res, 404, { error: 'Not found' });
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  } catch (error) {
    sendJson(res, 500, { error: 'Server error', details: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`Kovers server running on http://localhost:${PORT}`);
});
