import { openPanel, closePanel, appendLine, prependLines, getPanelIds } from './panels.js';

const POLL_INTERVAL_MS = 10_000;
const WS_RECONNECT_BASE_MS = 1000;
const WS_RECONNECT_MAX_MS = 30_000;

let ws = null;
let wsReconnectDelay = WS_RECONNECT_BASE_MS;
let wsReconnectTimer = null;
let openPanelKeys = new Set(); // "group/ns/pod"

function panelKey(group, ns, pod) {
  return `${group}/${ns}/${pod}`;
}

// ── WebSocket ──────────────────────────────────────────────────────────────

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  const dot = document.getElementById('conn-status');
  if (dot) dot.className = '';

  ws.addEventListener('open', () => {
    wsReconnectDelay = WS_RECONNECT_BASE_MS;
    if (dot) dot.className = 'connected';
    // Re-subscribe to all open panels after reconnect
    for (const key of openPanelKeys) {
      const [group, ns, pod] = key.split('/');
      wsSend({ type: 'subscribe', group, ns, pod });
    }
  });

  ws.addEventListener('message', e => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    const { group, ns, pod, ts, text } = msg;
    if (group && ns && pod && text !== undefined) {
      appendLine(group, ns, pod, ts || '', text);
    }
  });

  ws.addEventListener('close', () => {
    if (dot) dot.className = 'error';
    wsReconnectTimer = setTimeout(() => {
      wsReconnectDelay = Math.min(wsReconnectDelay * 2, WS_RECONNECT_MAX_MS);
      connectWS();
    }, wsReconnectDelay);
  });

  ws.addEventListener('error', () => ws.close());
}

function wsSend(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

// ── Panel lifecycle ────────────────────────────────────────────────────────

async function openPodPanel(group, ns, pod) {
  const key = panelKey(group, ns, pod);
  openPanelKeys.add(key);

  const id = openPanel(group, ns, pod, () => {});
  wsSend({ type: 'subscribe', group, ns, pod });

  // Backfill from history
  try {
    const resp = await fetch(`/api/logs?group=${encodeURIComponent(group)}&ns=${encodeURIComponent(ns)}&pod=${encodeURIComponent(pod)}&lines=500`);
    const lines = await resp.json();
    if (Array.isArray(lines) && lines.length) {
      prependLines(group, ns, pod, lines);
    }
  } catch { /* ignore — live stream will work regardless */ }

  renderSidebar();
  return id;
}

document.addEventListener('panel:closed', e => {
  const { group, ns, pod } = e.detail;
  const key = panelKey(group, ns, pod);
  openPanelKeys.delete(key);
  wsSend({ type: 'unsubscribe', group, ns, pod });
  renderSidebar();
});

// ── Sidebar ────────────────────────────────────────────────────────────────

let groups = [];

function renderSidebar() {
  const list = document.getElementById('pod-list');
  list.innerHTML = '';

  if (!groups.length) {
    const empty = document.createElement('div');
    empty.className = 'panel-status';
    empty.textContent = 'No pods discovered yet…';
    list.appendChild(empty);
    return;
  }

  for (const g of groups) {
    const heading = document.createElement('div');
    heading.className = 'pod-group-name';
    heading.textContent = g.name;
    list.appendChild(heading);

    for (const p of (g.pods || [])) {
      const key = panelKey(g.name, p.namespace, p.pod);
      const item = document.createElement('div');
      item.className = 'pod-item' + (openPanelKeys.has(key) ? ' open' : '');

      const dot = document.createElement('span');
      dot.className = 'pod-dot';

      const name = document.createElement('span');
      name.className = 'pod-name';
      name.textContent = p.pod;
      name.title = p.pod;

      const ns = document.createElement('span');
      ns.className = 'pod-ns';
      ns.textContent = p.namespace;

      item.appendChild(dot);
      item.appendChild(name);
      item.appendChild(ns);
      item.addEventListener('click', () => {
        openPodPanel(g.name, p.namespace, p.pod);
        document.getElementById('sidebar').classList.add('hidden');
      });
      list.appendChild(item);
    }
  }
}

async function pollGroups() {
  try {
    const resp = await fetch('/api/groups');
    const data = await resp.json();
    groups = data.groups || [];
    renderSidebar();
  } catch { /* server not ready yet */ }
}

// ── Init ───────────────────────────────────────────────────────────────────

function init() {
  // Add connection status dot to header
  const header = document.getElementById('header');
  const dot = document.createElement('span');
  dot.id = 'conn-status';
  dot.title = 'WebSocket connection';
  header.appendChild(dot);

  document.getElementById('btn-open-sidebar').addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('hidden');
  });
  document.getElementById('btn-close-sidebar').addEventListener('click', () => {
    document.getElementById('sidebar').classList.add('hidden');
  });

  connectWS();
  pollGroups();
  setInterval(pollGroups, POLL_INTERVAL_MS);
}

init();
