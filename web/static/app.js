import { openPanel, closePanel, appendLine, prependLines, getPanelIds } from './panels.js';

const POLL_INTERVAL_MS = 10_000;
const WS_RECONNECT_BASE_MS = 1000;
const WS_RECONNECT_MAX_MS = 30_000;

let ws = null;
let wsReconnectDelay = WS_RECONNECT_BASE_MS;
let wsReconnectTimer = null;
let openPanelKeys = new Set(); // "group/ns/pod/container"

function panelKey(group, ns, pod, container) {
  return `${group}/${ns}/${pod}/${container}`;
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
      const [group, ns, pod, container] = key.split('/');
      wsSend({ type: 'subscribe', group, ns, pod, container });
    }
  });

  ws.addEventListener('message', e => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    const { group, ns, pod, container, ts, message, fields } = msg;
    if (group && ns && pod && container && message !== undefined) {
      appendLine(group, ns, pod, container, ts || '', message, fields || null);
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

async function openPodPanel(group, ns, pod, container) {
  const key = panelKey(group, ns, pod, container);
  openPanelKeys.add(key);

  const id = openPanel(group, ns, pod, container, () => {});
  wsSend({ type: 'subscribe', group, ns, pod, container });

  // Backfill from history
  try {
    const resp = await fetch(`/api/logs?group=${encodeURIComponent(group)}&ns=${encodeURIComponent(ns)}&pod=${encodeURIComponent(pod)}&container=${encodeURIComponent(container)}&lines=500`);
    const lines = await resp.json();
    if (Array.isArray(lines) && lines.length) {
      prependLines(group, ns, pod, container, lines);
    }
  } catch { /* ignore — live stream will work regardless */ }

  renderSidebar();
  return id;
}

document.addEventListener('panel:closed', e => {
  const { group, ns, pod, container } = e.detail;
  const key = panelKey(group, ns, pod, container);
  openPanelKeys.delete(key);
  wsSend({ type: 'unsubscribe', group, ns, pod, container });
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
      const key = panelKey(g.name, p.namespace, p.pod, p.container);
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
        openPodPanel(g.name, p.namespace, p.pod, p.container);
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
