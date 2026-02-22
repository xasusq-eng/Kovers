const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = process.env.PORT || 4173;
const DATA_FILE = path.join(__dirname, 'kovers-data.json');

const sessions = new Map();

function nowIso() {
  return new Date().toISOString();
}

function createInitialData() {
  return {
    rooms: [
      { id: 'general', name: 'Общий', isPrivate: true, createdAt: nowIso() },
      { id: 'ideas', name: 'Идеи', isPrivate: true, createdAt: nowIso() },
      { id: 'support', name: 'Поддержка', isPrivate: true, createdAt: nowIso() }
    ],
    messages: {
      general: [
        {
          id: crypto.randomUUID(),
          roomId: 'general',
          author: 'Kovers Bot',
          text: 'Добро пожаловать в Kovers. Это полностью рабочий MVP-чата на собственном backend.',
          createdAt: nowIso()
        }
      ],
      ideas: [],
      support: []
    }
  };
}

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    const seed = createInitialData();
    fs.writeFileSync(DATA_FILE, JSON.stringify(seed, null, 2), 'utf8');
    return seed;
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

let db = loadData();

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function notFound(res) {
  sendJson(res, 404, { error: 'Not found' });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (chunk) => {
      buf += chunk;
      if (buf.length > 1_000_000) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!buf) return resolve({});
      try {
        resolve(JSON.parse(buf));
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function authUser(req) {
  const token = req.headers['x-kovers-token'];
  if (!token) return null;
  return sessions.get(token) || null;
}

function serveStatic(req, res, pathname) {
  const fileMap = {
    '/': 'index.html',
    '/index.html': 'index.html',
    '/styles.css': 'styles.css',
    '/script.js': 'script.js'
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
  const type = ext === '.html'
    ? 'text/html; charset=utf-8'
    : ext === '.css'
      ? 'text/css; charset=utf-8'
      : 'application/javascript; charset=utf-8';

  const content = fs.readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': content.length });
  res.end(content);
  return true;
}

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);
    const { pathname, searchParams } = requestUrl;

    if (serveStatic(req, res, pathname)) return;

    if (req.method === 'POST' && pathname === '/api/auth/guest') {
      const body = await parseBody(req);
      const username = String(body.username || '').trim().slice(0, 24);
      if (!username) return sendJson(res, 400, { error: 'Введите имя пользователя' });

      const token = crypto.randomBytes(24).toString('hex');
      sessions.set(token, { username, createdAt: nowIso() });
      return sendJson(res, 201, { token, username });
    }

    if (pathname.startsWith('/api/')) {
      const user = authUser(req);
      if (!user) return sendJson(res, 401, { error: 'Требуется авторизация' });

      if (req.method === 'GET' && pathname === '/api/me') {
        return sendJson(res, 200, { username: user.username });
      }

      if (req.method === 'GET' && pathname === '/api/rooms') {
        return sendJson(res, 200, { rooms: db.rooms });
      }

      if (req.method === 'POST' && pathname === '/api/rooms') {
        const body = await parseBody(req);
        const name = String(body.name || '').trim().slice(0, 40);
        if (!name) return sendJson(res, 400, { error: 'Название комнаты обязательно' });

        const id = crypto.randomUUID();
        const room = { id, name, isPrivate: true, createdAt: nowIso() };
        db.rooms.push(room);
        db.messages[id] = [];
        saveData(db);
        return sendJson(res, 201, { room });
      }

      if (req.method === 'GET' && pathname === '/api/messages') {
        const roomId = searchParams.get('roomId');
        const since = searchParams.get('since');
        if (!roomId || !db.messages[roomId]) return sendJson(res, 404, { error: 'Комната не найдена' });

        const list = db.messages[roomId] || [];
        const filtered = since ? list.filter((m) => m.createdAt > since) : list;
        return sendJson(res, 200, { messages: filtered.slice(-200) });
      }

      if (req.method === 'POST' && pathname === '/api/messages') {
        const body = await parseBody(req);
        const roomId = String(body.roomId || '');
        const text = String(body.text || '').trim().slice(0, 1500);
        if (!roomId || !db.messages[roomId]) return sendJson(res, 404, { error: 'Комната не найдена' });
        if (!text) return sendJson(res, 400, { error: 'Пустое сообщение' });

        const message = {
          id: crypto.randomUUID(),
          roomId,
          author: user.username,
          text,
          createdAt: nowIso()
        };
        db.messages[roomId].push(message);
        saveData(db);
        return sendJson(res, 201, { message });
      }

      return notFound(res);
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
