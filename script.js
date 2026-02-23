const s = { token: localStorage.getItem('kovers_token') || '', mode: 'login', me: null, rooms: [], roomId: '', since: {}, timer: null };

const el = {
  auth: document.getElementById('auth'),
  app: document.getElementById('app'),
  tabLogin: document.getElementById('tab-login'),
  tabRegister: document.getElementById('tab-register'),
  authForm: document.getElementById('auth-form'),
  authUsername: document.getElementById('auth-username'),
  authPassword: document.getElementById('auth-password'),
  authSubmit: document.getElementById('auth-submit'),
  authError: document.getElementById('auth-error'),
  me: document.getElementById('me'),
  rooms: document.getElementById('rooms'),
  roomTitle: document.getElementById('room-title'),
  messages: document.getElementById('messages'),
  sendForm: document.getElementById('send-form'),
  message: document.getElementById('message'),
  newRoom: document.getElementById('new-room'),
  newDm: document.getElementById('new-dm'),
  logout: document.getElementById('logout'),
  startVoice: document.getElementById('start-voice'),
  startVideo: document.getElementById('start-video'),
  calls: document.getElementById('calls')
};

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(s.token ? { 'x-kovers-token': s.token } : {}),
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Ошибка');
  return data;
}

function setMode(mode) {
  s.mode = mode;
  el.tabLogin.classList.toggle('active', mode === 'login');
  el.tabRegister.classList.toggle('active', mode === 'register');
  el.authSubmit.textContent = mode === 'login' ? 'Войти' : 'Создать аккаунт';
  el.authError.textContent = '';
}

function enterApp() {
  el.auth.classList.add('hidden');
  el.app.classList.remove('hidden');
  el.me.textContent = `@${s.me.username}`;
}

function leaveApp() {
  el.auth.classList.remove('hidden');
  el.app.classList.add('hidden');
  localStorage.removeItem('kovers_token');
  s.token = '';
  s.me = null;
  clearInterval(s.timer);
}

function roomName(r) { return r.type === 'dm' ? `👤 ${r.title}` : `# ${r.title}`; }

function renderRooms() {
  el.rooms.innerHTML = '';
  if (!s.rooms.length) {
    el.rooms.innerHTML = '<li>Пока нет чатов. Создай первый.</li>';
    return;
  }
  s.rooms.forEach((r) => {
    const li = document.createElement('li');
    li.textContent = roomName(r);
    if (r.id === s.roomId) li.classList.add('active');
    li.onclick = () => openRoom(r.id);
    el.rooms.appendChild(li);
  });
}

function formatTime(t) { return new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); }

function renderMessage(m) {
  const div = document.createElement('article');
  div.className = 'msg';
  div.innerHTML = `<div class="meta">${m.author} • ${formatTime(m.createdAt)}</div><div>${m.text}</div>`;
  el.messages.appendChild(div);
}

async function loadRooms() {
  const { rooms } = await api('/api/rooms');
  s.rooms = rooms;
  if (s.roomId && !rooms.find((r) => r.id === s.roomId)) s.roomId = '';
  if (!s.roomId && rooms[0]) s.roomId = rooms[0].id;
  renderRooms();
  await loadMessages(true);
  await loadCalls();
}

async function openRoom(roomId) {
  s.roomId = roomId;
  renderRooms();
  await loadMessages(true);
  await loadCalls();
}

async function loadMessages(full = false) {
  if (!s.roomId) {
    el.messages.innerHTML = '<article class="msg">Нет выбранного чата.</article>';
    el.roomTitle.textContent = 'Выберите чат';
    return;
  }
  const room = s.rooms.find((r) => r.id === s.roomId);
  el.roomTitle.textContent = roomName(room);

  const params = new URLSearchParams({ roomId: s.roomId });
  if (!full && s.since[s.roomId]) params.set('since', s.since[s.roomId]);
  const { messages } = await api(`/api/messages?${params}`);
  if (full) el.messages.innerHTML = '';
  messages.forEach(renderMessage);
  if (messages.length) s.since[s.roomId] = messages[messages.length - 1].createdAt;
  el.messages.scrollTop = el.messages.scrollHeight;
}

async function loadCalls() {
  el.calls.innerHTML = '';
  if (!s.roomId) return;
  const { calls } = await api(`/api/calls?roomId=${encodeURIComponent(s.roomId)}`);
  if (!calls.length) {
    el.calls.innerHTML = '<div class="call">Активных звонков нет</div>';
    return;
  }
  calls.forEach((c) => {
    const d = document.createElement('div');
    d.className = 'call';
    d.innerHTML = `${c.type === 'video' ? '📹' : '🎙'} ${c.participants.join(', ')}`;
    const join = document.createElement('button');
    join.type = 'button';
    join.textContent = 'Войти';
    join.onclick = async () => { await api('/api/calls/join', { method: 'POST', body: JSON.stringify({ callId: c.id }) }); await loadCalls(); };
    const end = document.createElement('button');
    end.type = 'button';
    end.textContent = 'Завершить';
    end.onclick = async () => { await api('/api/calls/end', { method: 'POST', body: JSON.stringify({ callId: c.id }) }); await loadCalls(); };
    d.append(' ', join, ' ', end);
    el.calls.appendChild(d);
  });
}

el.tabLogin.onclick = () => setMode('login');
el.tabRegister.onclick = () => setMode('register');

el.authForm.onsubmit = async (e) => {
  e.preventDefault();
  try {
    const username = el.authUsername.value.trim().toLowerCase();
    const password = el.authPassword.value;
    if (s.mode === 'register') {
      await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) });
      setMode('login');
      el.authError.textContent = 'Аккаунт создан. Теперь войдите.';
      return;
    }
    const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    s.token = data.token;
    localStorage.setItem('kovers_token', s.token);
    s.me = await api('/api/me');
    enterApp();
    await loadRooms();
    s.timer = setInterval(() => { loadMessages(false).catch(() => {}); loadCalls().catch(() => {}); }, 1300);
  } catch (err) {
    el.authError.textContent = err.message;
  }
};

el.sendForm.onsubmit = async (e) => {
  e.preventDefault();
  if (!s.roomId) return;
  const text = el.message.value.trim();
  if (!text) return;
  await api('/api/messages', { method: 'POST', body: JSON.stringify({ roomId: s.roomId, text }) });
  el.message.value = '';
  await loadMessages(false);
};

el.newRoom.onclick = async () => {
  const name = prompt('Название группы:');
  if (!name) return;
  const memberInput = prompt('Добавить участников через запятую (логины), необязательно:') || '';
  const members = memberInput.split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
  const { room } = await api('/api/rooms', { method: 'POST', body: JSON.stringify({ name, members }) });
  s.roomId = room.id;
  await loadRooms();
};

el.newDm.onclick = async () => {
  const username = prompt('Логин пользователя для личного чата:');
  if (!username) return;
  const { room } = await api('/api/dm', { method: 'POST', body: JSON.stringify({ username }) });
  s.roomId = room.id;
  await loadRooms();
};

el.startVoice.onclick = async () => {
  if (!s.roomId) return;
  await api('/api/calls/start', { method: 'POST', body: JSON.stringify({ roomId: s.roomId, type: 'voice' }) });
  await loadCalls();
};

el.startVideo.onclick = async () => {
  if (!s.roomId) return;
  await api('/api/calls/start', { method: 'POST', body: JSON.stringify({ roomId: s.roomId, type: 'video' }) });
  await loadCalls();
};

el.logout.onclick = async () => {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
  leaveApp();
};

(async () => {
  if (!s.token) return;
  try {
    s.me = await api('/api/me');
    enterApp();
    await loadRooms();
    s.timer = setInterval(() => { loadMessages(false).catch(() => {}); loadCalls().catch(() => {}); }, 1300);
  } catch {
    leaveApp();
  }
})();
