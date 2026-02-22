const form = document.getElementById('composer');
const input = document.getElementById('message');
const messages = document.getElementById('messages');

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const value = input.value.trim();

  if (!value) {
    return;
  }

  const article = document.createElement('article');
  const title = document.createElement('h3');
  title.innerHTML = `Вы <span>${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>`;

  const text = document.createElement('p');
  text.textContent = value;

  article.append(title, text);
  messages.appendChild(article);
  messages.scrollTop = messages.scrollHeight;
  input.value = '';
});
