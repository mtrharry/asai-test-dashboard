// Chat view — vanilla JS module
// Conecta con el backend en /api/v1, que a su vez proxea al orquestador N8N.

const API = 'http://localhost:8000/api/v1';

const state = {
  sessions: [],
  currentSessionId: null,
  messages: [],         // {role: 'user'|'assistant', text, ts}
  files: [],            // {name, size, status: 'uploading'|'uploaded'|'error'}
  thinking: false
};

// DOM
let elSessionList, elSessions, elMessages, elInput, elSendBtn,
    elDropZone, elFileInput, elFilesList, elTitle, elMeta, elNewBtn;

export function initChatView() {
  elSessionList = document.getElementById('chat-session-list');
  elMessages    = document.getElementById('chat-messages');
  elInput       = document.getElementById('chat-input');
  elSendBtn     = document.getElementById('chat-send');
  elDropZone    = document.getElementById('chat-drop-zone');
  elFileInput   = document.getElementById('chat-file-input');
  elFilesList   = document.getElementById('chat-files-list');
  elTitle       = document.getElementById('chat-current-title');
  elMeta        = document.getElementById('chat-current-meta');
  elNewBtn      = document.getElementById('chat-new-session');

  elNewBtn.addEventListener('click', createSession);
  elSendBtn.addEventListener('click', sendMessage);
  elInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Drop zone
  elDropZone.addEventListener('click', () => {
    if (state.currentSessionId) elFileInput.click();
  });
  elFileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) uploadFile(e.target.files[0]);
    e.target.value = '';
  });
  ['dragenter', 'dragover'].forEach((ev) => {
    elDropZone.addEventListener(ev, (e) => {
      e.preventDefault();
      if (state.currentSessionId) elDropZone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach((ev) => {
    elDropZone.addEventListener(ev, (e) => {
      e.preventDefault();
      elDropZone.classList.remove('dragover');
    });
  });
  elDropZone.addEventListener('drop', (e) => {
    if (!state.currentSessionId) return;
    const file = e.dataTransfer.files[0];
    if (file) uploadFile(file);
  });

  loadSessions();
}

// --- Sessions ---
async function loadSessions() {
  try {
    const res = await fetch(API + '/sessions/');
    const data = await res.json();
    state.sessions = Array.isArray(data) ? data : (data.sessions || []);
    renderSessionList();
  } catch (e) {
    elSessionList.innerHTML = '<div class="chat-empty">Error: ' + e.message + '</div>';
  }
}

function renderSessionList() {
  if (state.sessions.length === 0) {
    elSessionList.innerHTML = '<div class="chat-empty">Sin sesiones aun.<br/>Crea una con +</div>';
    return;
  }
  elSessionList.innerHTML = '';
  state.sessions
    .slice()
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .forEach((s) => {
      const item = document.createElement('div');
      item.className = 'chat-session-item' + (s.id === state.currentSessionId ? ' active' : '');
      const fecha = new Date(s.created_at).toLocaleString('es-AR', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
      });
      item.innerHTML =
        '<div class="ses-id">' + s.id.substring(0, 8) + '...</div>' +
        '<div class="ses-meta">' + fecha + ' · ' + (s.status || 'active') + '</div>';
      item.addEventListener('click', () => selectSession(s.id));
      elSessionList.appendChild(item);
    });
}

async function createSession() {
  try {
    const res = await fetch(API + '/sessions/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: 'harry-test' })
    });
    const data = await res.json();
    await loadSessions();
    selectSession(data.id);
  } catch (e) {
    alert('No se pudo crear la sesion: ' + e.message);
  }
}

async function selectSession(id) {
  state.currentSessionId = id;
  state.messages = [];
  state.files = [];
  renderSessionList();

  const ses = state.sessions.find((s) => s.id === id);
  if (ses) {
    elTitle.textContent = 'Sesion ' + id.substring(0, 8);
    elMeta.textContent = id + ' · creada ' +
      new Date(ses.created_at).toLocaleString('es-AR');
  }

  elInput.disabled = false;
  elSendBtn.disabled = false;
  elDropZone.classList.remove('disabled');

  // Load existing chat history
  state.messages = [];
  state.files = [];
  try {
    const res = await fetch(API + '/sessions/' + id + '/messages');
    if (res.ok) {
      const msgs = await res.json();
      msgs.forEach((m) => {
        if (m.question) state.messages.push({ role: 'user', text: m.question, ts: m.created_at });
        if (m.answer) state.messages.push({ role: 'assistant', text: m.answer, ts: m.created_at });
      });
    }
  } catch (e) {
    // ok si la sesion es nueva
  }

  renderMessages();
  renderFiles();
}

// --- Messages ---
function renderMessages() {
  if (state.messages.length === 0 && !state.thinking) {
    elMessages.innerHTML =
      '<div class="chat-welcome">' +
      '<h2>Sesion lista</h2>' +
      '<p>Empeza la conversacion con el asistente.</p>' +
      '</div>';
    return;
  }
  elMessages.innerHTML = '';
  state.messages.forEach((m) => {
    const div = document.createElement('div');
    div.className = 'chat-message ' + m.role;
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.textContent = m.text;
    div.appendChild(bubble);
    if (m.ts) {
      const meta = document.createElement('div');
      meta.className = 'chat-meta';
      meta.textContent = new Date(m.ts).toLocaleTimeString('es-AR');
      div.appendChild(meta);
    }
    elMessages.appendChild(div);
  });
  elMessages.scrollTop = elMessages.scrollHeight;
}

// --- Thinking animation ---
const STEPS = [
  { id: 'orq',  label: 'Orquestador clasificando intencion...', delay: 0    },
  { id: 'tool', label: 'Decidiendo herramienta a usar...',       delay: 1500 },
  { id: 'rag',  label: 'Consultando documentos / RAG...',        delay: 3000 },
  { id: 'gen',  label: 'Generando respuesta...',                 delay: 5000 }
];

let thinkingTimers = [];

function startThinking() {
  state.thinking = true;
  // Append thinking bubble
  const wrapper = document.createElement('div');
  wrapper.className = 'chat-message assistant';
  wrapper.id = 'chat-thinking-bubble';
  wrapper.innerHTML = '<div class="chat-thinking" id="chat-thinking-inner"></div>';
  elMessages.appendChild(wrapper);
  elMessages.scrollTop = elMessages.scrollHeight;

  const inner = document.getElementById('chat-thinking-inner');

  STEPS.forEach((step, i) => {
    const t = setTimeout(() => {
      // Mark previous as done
      const prev = inner.querySelector('.chat-step.active');
      if (prev) {
        prev.classList.remove('active');
        prev.classList.add('done');
      }
      // Add this step
      const el = document.createElement('div');
      el.className = 'chat-step active';
      el.dataset.stepId = step.id;
      el.innerHTML = '<span class="chat-step-icon"></span><span>' + step.label + '</span>';
      inner.appendChild(el);
      elMessages.scrollTop = elMessages.scrollHeight;
    }, step.delay);
    thinkingTimers.push(t);
  });
}

function stopThinking() {
  thinkingTimers.forEach((t) => clearTimeout(t));
  thinkingTimers = [];
  const bubble = document.getElementById('chat-thinking-bubble');
  if (bubble) bubble.remove();
  state.thinking = false;
}

// --- Send message ---
async function sendMessage() {
  const text = elInput.value.trim();
  if (!text || !state.currentSessionId || state.thinking) return;

  state.messages.push({ role: 'user', text: text, ts: new Date().toISOString() });
  elInput.value = '';
  renderMessages();
  startThinking();

  elSendBtn.disabled = true;
  elInput.disabled = true;

  try {
    const res = await fetch(API + '/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: state.currentSessionId, mensaje: text })
    });
    const data = await res.json();

    stopThinking();

    if (!res.ok) {
      state.messages.push({
        role: 'assistant',
        text: 'Error ' + res.status + ': ' + (data.detail || JSON.stringify(data)),
        ts: new Date().toISOString()
      });
    } else {
      state.messages.push({
        role: 'assistant',
        text: data.respuesta || '(respuesta vacia)',
        ts: data.timestamp || new Date().toISOString()
      });
    }
    renderMessages();
  } catch (e) {
    stopThinking();
    state.messages.push({
      role: 'assistant',
      text: 'Error de red: ' + e.message,
      ts: new Date().toISOString()
    });
    renderMessages();
  } finally {
    elSendBtn.disabled = false;
    elInput.disabled = false;
    elInput.focus();
  }
}

// --- Upload ---
function renderFiles() {
  if (state.files.length === 0) {
    elFilesList.innerHTML = '<div class="chat-empty">Sin archivos</div>';
    return;
  }
  elFilesList.innerHTML = '';
  state.files.forEach((f) => {
    const div = document.createElement('div');
    div.className = 'chat-file-item ' + (f.status || 'uploaded');
    const sizeKB = f.size ? (f.size / 1024).toFixed(1) + ' KB' : '';
    div.innerHTML =
      '<div class="file-name">' + f.name + '</div>' +
      '<div class="file-meta">' + (f.status || 'uploaded') + (sizeKB ? ' · ' + sizeKB : '') + '</div>';
    elFilesList.appendChild(div);
  });
}

async function uploadFile(file) {
  if (!state.currentSessionId) return;

  const entry = { name: file.name, size: file.size, status: 'uploading' };
  state.files.push(entry);
  renderFiles();

  const fd = new FormData();
  fd.append('file', file);
  fd.append('session_id', state.currentSessionId);
  fd.append('filename', file.name);

  try {
    const res = await fetch(
      API + '/evidencia/?session_id=' + encodeURIComponent(state.currentSessionId),
      { method: 'POST', body: fd }
    );
    const data = await res.json();
    entry.status = (res.ok && (data.status === 'indexed' || data.status === 'processing'))
      ? 'uploaded'
      : 'error';
  } catch (e) {
    entry.status = 'error';
  }
  renderFiles();
}
