import { initChatView } from './chat.js';

const API = 'http://localhost:8000/api/v1';
const N8N = 'http://localhost:5678/webhook';

let currentSession = null;
let lastRawResponse = null;

// DOM refs
const flowLog = document.getElementById('flow-log');
const sessionSelect = document.getElementById('session-select');
const sessionInfo = document.getElementById('session-info');
const questionInput = document.getElementById('question-input');
const resultAnswer = document.getElementById('result-answer');
const resultSources = document.getElementById('result-sources');
const resultRaw = document.getElementById('result-raw');
const resultHistory = document.getElementById('result-history');

// --- Flow Logger ---
function log(label, detail, type, json) {
  type = type || 'info';
  if (flowLog.querySelector('.flow-empty')) flowLog.innerHTML = '';
  var step = document.createElement('div');
  step.className = 'flow-step ' + type;
  var now = new Date().toLocaleTimeString('es-AR');
  var html = '<div class="step-time">' + now + '</div>';
  html += '<div class="step-label">' + label + '</div>';
  if (detail) html += '<div class="step-detail">' + detail + '</div>';
  if (json) html += '<div class="step-json">' + safeJson(json) + '</div>';
  step.innerHTML = html;
  flowLog.appendChild(step);
  flowLog.scrollTop = flowLog.scrollHeight;
}

function safeJson(obj) {
  try { return JSON.stringify(obj, null, 2); }
  catch(e) { return String(obj); }
}

// --- Health Checks ---
async function checkHealth() {
  var services = [
    { id: 'h-backend', url: 'http://localhost:8000/health' },
    { id: 'h-n8n', url: 'http://localhost:5678/healthz' },
    { id: 'h-aivi', url: 'http://localhost:5173/api/health' },
    { id: 'h-db', url: 'http://localhost:8000/health' }
  ];
  for (var i = 0; i < services.length; i++) {
    var s = services[i];
    var el = document.getElementById(s.id);
    try {
      var res = await fetch(s.url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) { el.className = 'health-item online'; }
      else { el.className = 'health-item offline'; }
    } catch(e) {
      el.className = 'health-item offline';
    }
  }
}

// --- Sessions ---
async function createSession() {
  log('FASTAPI', 'POST /api/v1/sessions/', 'info');
  try {
    var res = await fetch(API + '/sessions/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: 'harry-test' })
    });
    var data = await res.json();
    log('FASTAPI', 'Sesion creada: ' + data.id.substring(0, 8) + '...', 'success', data);
    await loadSessions();
    sessionSelect.value = data.id;
    selectSession(data.id);
  } catch(e) {
    log('ERROR', 'No se pudo crear sesion: ' + e.message, 'error');
  }
}

async function loadSessions() {
  log('FASTAPI', 'GET /api/v1/sessions/', 'info');
  try {
    var res = await fetch(API + '/sessions/');
    var data = await res.json();
    var arr = Array.isArray(data) ? data : (data.sessions || []);
    sessionSelect.innerHTML = '<option value="">-- Seleccionar sesion --</option>';
    arr.forEach(function(s) {
      var opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.id.substring(0, 12) + '... (' + (s.status || 'active') + ')';
      sessionSelect.appendChild(opt);
    });
    log('FASTAPI', arr.length + ' sesiones cargadas', 'success');
  } catch(e) {
    log('ERROR', 'No se pudieron cargar sesiones: ' + e.message, 'error');
  }
}

async function selectSession(id) {
  if (!id) {
    currentSession = null;
    sessionInfo.classList.add('hidden');
    return;
  }
  log('FASTAPI', 'GET /api/v1/sessions/' + id.substring(0, 8) + '...', 'info');
  try {
    var res = await fetch(API + '/sessions/' + id);
    var data = await res.json();
    currentSession = data;
    sessionInfo.classList.remove('hidden');
    sessionInfo.textContent = 'ID: ' + data.id + '\nStatus: ' + (data.status || 'active') + '\nCreada: ' + new Date(data.created_at).toLocaleString('es-AR');
    log('FASTAPI', 'Sesion seleccionada', 'success', data);

    // Load chat history
    loadHistory(id);
  } catch(e) {
    log('ERROR', 'Error cargando sesion: ' + e.message, 'error');
  }
}

async function loadHistory(sessionId) {
  try {
    var res = await fetch(API + '/sessions/' + sessionId);
    var data = await res.json();
    var msgs = data.messages || data.chat_history || [];
    if (msgs.length > 0) {
      var html = '';
      msgs.forEach(function(m, i) {
        html += '<div style="margin-bottom:12px;padding:8px;background:var(--surface-2);border-radius:6px">';
        html += '<div style="color:var(--accent);font-size:11px;font-weight:600">PREGUNTA #' + (i+1) + '</div>';
        html += '<div>' + (m.question || m.pregunta || '') + '</div>';
        html += '<div style="color:var(--success);font-size:11px;font-weight:600;margin-top:6px">RESPUESTA</div>';
        html += '<div>' + (m.answer || m.respuesta || '') + '</div>';
        html += '</div>';
      });
      resultHistory.innerHTML = html;
      log('BD', msgs.length + ' mensajes en historial', 'info');
    } else {
      resultHistory.textContent = 'Sin mensajes previos.';
    }
  } catch(e) {
    resultHistory.textContent = 'Error cargando historial: ' + e.message;
  }
}

// --- File Upload ---
async function uploadFile(file) {
  if (!currentSession) {
    log('ERROR', 'Selecciona una sesion primero', 'error');
    return;
  }

  var fname = file.name;
  var fsize = (file.size / 1024).toFixed(1) + ' KB';
  var ftype = file.type || 'unknown';

  log('UPLOAD', 'Archivo: ' + fname + ' | Tamano: ' + fsize + ' | Tipo: ' + ftype, 'info');

  var formData = new FormData();
  formData.append('file', file);
  formData.append('session_id', currentSession.id);
  formData.append('filename', fname);

  log('BACKEND', 'POST ' + API + '/evidencia/?session_id=' + currentSession.id.substring(0,8) + '...', 'info');
  log('BACKEND', 'Enviando archivo como multipart/form-data', 'info');

  try {
    var t0 = Date.now();
    var res = await fetch(API + '/evidencia/?session_id=' + currentSession.id, {
      method: 'POST',
      body: formData
    });
    var elapsed = Date.now() - t0;
    var data = await res.json();

    log('BACKEND', 'Respuesta en ' + elapsed + 'ms | HTTP ' + res.status, 'success', data);

    if (data.store) {
      log('GEMINI', 'Archivo indexado en store: ' + data.store, 'success');
    }
    if (data.status === 'indexed') {
      log('UPLOAD', 'OK - Archivo indexado correctamente', 'success');
    }
  } catch(e) {
    log('ERROR', 'Fallo upload: ' + e.message, 'error');
  }
}

// --- Chat / RAG Query ---
async function sendQuestion() {
  if (!currentSession) {
    log('ERROR', 'Selecciona una sesion primero', 'error');
    return;
  }

  var pregunta = questionInput.value.trim();
  if (!pregunta) {
    log('ERROR', 'Escribe una pregunta', 'error');
    return;
  }

  var showRaw = document.getElementById('chk-raw').checked;

  log('CHAT', 'Pregunta: "' + pregunta + '"', 'info');
  log('CHAT', 'Session ID: ' + currentSession.id, 'info');

  var payload = {
    session_id: currentSession.id,
    pregunta: pregunta
  };

  log('BACKEND', 'POST ' + API + '/chat/', 'info');
  if (showRaw) log('REQUEST', 'Payload enviado:', 'warn', payload);

  try {
    var t0 = Date.now();
    var res = await fetch(API + '/chat/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: currentSession.id,
        question: pregunta
      })
    });
    var elapsed = Date.now() - t0;
    var data = await res.json();
    lastRawResponse = data;

    log('BACKEND', 'Respuesta en ' + elapsed + 'ms | HTTP ' + res.status, 'success');

    // Parse response
    var respuesta = data.answer || data.respuesta || data.text || JSON.stringify(data);
    var fuentes = data.sources || data.fuentes || [];
    var tokens = data.tokens || {};

    // Log tokens
    if (tokens.entrada || tokens.salida) {
      log('GEMINI', 'Tokens entrada: ' + (tokens.entrada || '?') + ' | Tokens salida: ' + (tokens.salida || '?'), 'info');
    }

    // Log historial usado
    if (data.historial_mensajes_usados !== undefined) {
      log('BD', 'Mensajes de historial usados como contexto: ' + data.historial_mensajes_usados, 'info');
    }

    // Log sources
    if (fuentes.length > 0) {
      log('RAG', fuentes.length + ' fuente(s) encontrada(s):', 'info');
      fuentes.forEach(function(f, i) {
        log('RAG', '  ' + (i+1) + '. ' + (f.nombre || f.title || 'Documento') + (f.pagina ? ' (pag. ' + f.pagina + ')' : ''), 'info');
      });
    } else {
      log('RAG', 'Sin fuentes especificas en la respuesta', 'warn');
    }

    // Display result
    resultAnswer.textContent = respuesta || 'Sin respuesta del modelo.';

    if (fuentes.length > 0) {
      var srcHtml = '';
      fuentes.forEach(function(f, i) {
        srcHtml += '<div style="margin-bottom:8px;padding:8px;background:var(--surface-2);border-radius:6px">';
        srcHtml += '<div style="font-weight:600;color:var(--accent)">' + (f.nombre || f.title || 'Doc ' + (i+1)) + '</div>';
        if (f.extracto) srcHtml += '<div style="font-size:12px;color:var(--text-muted);margin-top:4px">"' + f.extracto.substring(0, 200) + '..."</div>';
        if (f.store) srcHtml += '<div style="font-size:11px;color:var(--text-dim);margin-top:4px">Store: ' + f.store + '</div>';
        srcHtml += '</div>';
      });
      resultSources.innerHTML = srcHtml;
    } else {
      resultSources.textContent = 'No se detectaron fuentes en la respuesta.';
    }

    // Raw JSON
    resultRaw.textContent = JSON.stringify(data, null, 2);

    // Switch to respuesta tab
    switchTab('respuesta');

    // Reload history
    loadHistory(currentSession.id);

  } catch(e) {
    log('ERROR', 'Fallo la consulta: ' + e.message, 'error');
    resultAnswer.textContent = 'ERROR: ' + e.message;
  }
}

// --- Tabs ---
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
  document.querySelectorAll('.tab-content').forEach(function(t) { t.classList.remove('active'); });
  document.querySelector('.tab[data-tab="' + name + '"]').classList.add('active');
  document.getElementById('tab-' + name).classList.add('active');
}

document.querySelectorAll('.tab').forEach(function(t) {
  t.addEventListener('click', function() { switchTab(t.dataset.tab); });
});

// --- Events ---
document.getElementById('btn-create-session').onclick = createSession;
document.getElementById('btn-load-sessions').onclick = loadSessions;
sessionSelect.onchange = function() { selectSession(this.value); };
document.getElementById('btn-send').onclick = sendQuestion;
document.getElementById('file-input').onchange = function(e) {
  if (e.target.files[0]) uploadFile(e.target.files[0]);
};
questionInput.onkeydown = function(e) {
  if (e.key === 'Enter' && e.ctrlKey) {
    e.preventDefault();
    sendQuestion();
  }
};


// --- Resizers ---
function initResizers() {
  // Horizontal resizer between controls and flow
  var panelControls = document.querySelector('.panel-controls');
  var panelFlow = document.querySelector('.panel-flow');
  var panelResult = document.querySelector('.panel-result');
  var testLayout = document.querySelector('.test-layout');

  // Create horizontal resizer
  var resH = document.createElement('div');
  resH.className = 'resizer resizer-h';
  panelControls.appendChild(resH);

  var startX, startW;
  resH.addEventListener('mousedown', function(e) {
    e.preventDefault();
    startX = e.clientX;
    startW = panelControls.offsetWidth;
    resH.classList.add('active');
    document.addEventListener('mousemove', onResizeH);
    document.addEventListener('mouseup', stopResizeH);
  });

  function onResizeH(e) {
    var newW = startW + (e.clientX - startX);
    if (newW >= 240 && newW <= 600) {
      panelControls.style.width = newW + 'px';
    }
  }

  function stopResizeH() {
    resH.classList.remove('active');
    document.removeEventListener('mousemove', onResizeH);
    document.removeEventListener('mouseup', stopResizeH);
  }

  // Vertical resizer between flow and result
  var resV = document.createElement('div');
  resV.className = 'resizer resizer-v';
  panelResult.insertBefore(resV, panelResult.firstChild);

  var startY, startH;
  resV.addEventListener('mousedown', function(e) {
    e.preventDefault();
    startY = e.clientY;
    startH = panelResult.offsetHeight;
    resV.classList.add('active');
    document.addEventListener('mousemove', onResizeV);
    document.addEventListener('mouseup', stopResizeV);
  });

  function onResizeV(e) {
    var newH = startH - (e.clientY - startY);
    if (newH >= 120 && newH <= window.innerHeight * 0.8) {
      panelResult.style.height = newH + 'px';
    }
  }

  function stopResizeV() {
    resV.classList.remove('active');
    document.removeEventListener('mousemove', onResizeV);
    document.removeEventListener('mouseup', stopResizeV);
  }
}

// --- Collapsible sections ---
function initCollapsibles() {
  var titles = document.querySelectorAll('.panel-controls .panel-title');
  titles.forEach(function(title) {
    title.classList.add('collapsible-header');
    var next = title.nextElementSibling;
    var body = document.createElement('div');
    body.className = 'collapsible-body';
    var children = [];
    while (next && !next.classList.contains('panel-title')) {
      children.push(next);
      next = next.nextElementSibling;
    }
    children.forEach(function(child) { body.appendChild(child); });
    title.parentNode.insertBefore(body, title.nextSibling);

    title.addEventListener('click', function() {
      title.classList.toggle('collapsed');
      body.classList.toggle('collapsed');
    });
  });
}

// --- Init ---
log('SYSTEM', 'Test Dashboard iniciado', 'info');
log('SYSTEM', 'API: ' + API, 'info');
log('SYSTEM', 'N8N: ' + N8N, 'info');
log('SYSTEM', 'Ctrl+Enter para enviar pregunta', 'info');

checkHealth();
setInterval(checkHealth, 15000);
loadSessions();
initResizers();
initCollapsibles();

// --- App tabs (Dashboard / Chat) ---
const viewDashboard = document.querySelector('.view-dashboard');
const viewChat = document.querySelector('.view-chat');
document.querySelectorAll('.app-tab').forEach(function (btn) {
  btn.addEventListener('click', function () {
    document.querySelectorAll('.app-tab').forEach(function (b) { b.classList.remove('active'); });
    btn.classList.add('active');
    var v = btn.dataset.view;
    if (v === 'dashboard') {
      viewDashboard.classList.remove('hidden');
      viewChat.classList.add('hidden');
    } else {
      viewDashboard.classList.add('hidden');
      viewChat.classList.remove('hidden');
    }
  });
});

initChatView();
