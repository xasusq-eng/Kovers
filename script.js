const state = {
  token: localStorage.getItem('kovers_token') || '',
  username: localStorage.getItem('kovers_user') || '',
  rooms: [],
  currentRoomId: '',
  poller: null,
  lastMessageTsByRoom: {}
};

const authScreen = document.getElementById('auth-screen');
const app = document.getElementById('app');
const authForm = document.getElementById('auth-form');
const usernameInput = document.getElementById('username');
const userLabel = document.getElementById('current-user');
const roomList = document.getElementById('room-list');
const roomTitle = document.getElementById('room-title');
const messagesEl = document.getElementById('messages');
const composer = document.getElementById('composer');
const messageInput = document.getElementById('message-input');
const roomDialog = document.getElementById('room-dialog');
const createRoomBtn = document.getElementById('create-room-btn');
const roomForm = document.getElementById('room-form');
const roomNameInput = document.getElementById('room-name');
const cancelRoomBtn = document.getElementById('cancel-room');

function api(path, options = {}) {
  return fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(state.token ? { 'x-kovers-token': state.token } : {}),
      ...(options.headers || {})
    }
  }).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Ошибка API');
    return data;
  });
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function renderMessage(msg, append = true) {
  const item = document.createElement('article');
  item.className = 'msg';
  item.dataset.id = msg.id;
  item.innerHTML = `<div class="meta">${msg.author} • ${formatTime(msg.createdAt)}</div><div>${msg.text}</div>`;
  if (append) messagesEl.appendChild(item);
  else messagesEl.prepend(item);
}

function renderRooms() {
  roomList.innerHTML = '';
  state.rooms.forEach((room) => {
    const li = document.createElement('li');
    li.textContent = `# ${room.name}`;
    if (room.id === state.currentRoomId) li.classList.add('active');
    li.onclick = () => selectRoom(room.id);
    roomList.appendChild(li);
  });
}

async function loadRooms() {
  const { rooms } = await api('/api/rooms');
  state.rooms = rooms;
  if (!state.currentRoomId && rooms.length) state.currentRoomId = rooms[0].id;
  renderRooms();
  await loadMessages(true);
}

async function loadMessages(full = false) {
  if (!state.currentRoomId) return;
  const room = state.rooms.find((r) => r.id === state.currentRoomId);
  roomTitle.textContent = room ? `# ${room.name}` : '# Комната';

  const since = !full ? state.lastMessageTsByRoom[state.currentRoomId] : '';
  const params = new URLSearchParams({ roomId: state.currentRoomId });
  if (since) params.set('since', since);
  const { messages } = await api(`/api/messages?${params.toString()}`);

  if (full) messagesEl.innerHTML = '';
  messages.forEach((m) => renderMessage(m, true));
  if (messages.length) {
    state.lastMessageTsByRoom[state.currentRoomId] = messages[messages.length - 1].createdAt;
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function selectRoom(roomId) {
  state.currentRoomId = roomId;
  renderRooms();
  await loadMessages(true);
}

function startPolling() {
  stopPolling();
  state.poller = setInterval(() => {
    loadMessages(false).catch(() => {});
  }, 1200);
}

function stopPolling() {
  if (state.poller) clearInterval(state.poller);
  state.poller = null;
}

function enterApp() {
  authScreen.classList.add('hidden');
  app.classList.remove('hidden');
  userLabel.textContent = `Вы: ${state.username}`;
}

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = usernameInput.value.trim();
  if (!username) return;
  const data = await api('/api/auth/guest', { method: 'POST', body: JSON.stringify({ username }) });
  state.token = data.token;
  state.username = data.username;
  localStorage.setItem('kovers_token', state.token);
  localStorage.setItem('kovers_user', state.username);
  enterApp();
  await loadRooms();
  startPolling();
});

composer.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text || !state.currentRoomId) return;
  await api('/api/messages', { method: 'POST', body: JSON.stringify({ roomId: state.currentRoomId, text }) });
  messageInput.value = '';
  await loadMessages(false);
});

createRoomBtn.addEventListener('click', () => roomDialog.showModal());
cancelRoomBtn.addEventListener('click', () => roomDialog.close());
roomForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = roomNameInput.value.trim();
  if (!name) return;
  const { room } = await api('/api/rooms', { method: 'POST', body: JSON.stringify({ name }) });
  roomDialog.close();
  roomNameInput.value = '';
  state.currentRoomId = room.id;
  await loadRooms();
});

(async function boot() {
  if (!state.token || !state.username) return;
  try {
    await api('/api/me');
    enterApp();
    await loadRooms();
    startPolling();
  } catch {
    localStorage.removeItem('kovers_token');
    localStorage.removeItem('kovers_user');
  }
})();
