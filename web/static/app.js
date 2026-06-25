import { openPanel, closePanel, addPanelGroup, appendLines, prependLines, getPanelIds, applyFocusToAll, getSerializableState, restoreFilters, setActivePanelByKey, toggleMergedView } from './panels.js';
import { openFocusDialog, focusState, restoreFocusState } from './focus.js';
import { initEvents, openEventsDialog, updateEventsBtn } from './events.js';
import { initTimeline, refreshTimeline, refreshTimelineNow } from './event-timeline.js';
import { saveState, loadState } from './state.js';
import { initSelectionMenu } from './selection-menu.js';

const POLL_INTERVAL_MS = 10_000;
const WS_RECONNECT_BASE_MS = 1000;
const WS_RECONNECT_MAX_MS = 30_000;

let ws = null;
let wsReconnectDelay = WS_RECONNECT_BASE_MS;
let wsReconnectTimer = null;

// Map<key, count> — ref-counted so the same log can be open in multiple panel groups
const openPanelKeyCounts = new Map();
let restoringState = false;

let paused = false;
let pauseBuffer = [];

let liveBuffer = [];
let liveRafId = null;

function flushLiveBuffer() {
  liveRafId = null;
  if (!liveBuffer.length) return;
  const batch = liveBuffer;
  liveBuffer = [];
  appendLines(batch);
  refreshTimeline();
}

function panelKey(group, ns, pod, container) {
  return `${group}/${ns}/${pod}/${container}`;
}

// ── State persistence ──────────────────────────────────────────────────────

function serializeFocus() {
  return {
    active: focusState.active,
    patterns: focusState.patterns.map(p => p.pattern),
    contextEnabled: focusState.contextEnabled,
    contextType: focusState.contextType,
    contextAmount: focusState.contextAmount,
    contextDirection: focusState.contextDirection,
  };
}

function maybeSaveState() {
  if (restoringState) return;
  saveState(getSerializableState(), serializeFocus());
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
    // Re-subscribe to all open logs after reconnect
    for (const [key] of openPanelKeyCounts) {
      const [group, ns, pod, container] = key.split('/');
      wsSend({ type: 'subscribe', group, ns, pod, container });
    }
  });

  ws.addEventListener('message', e => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    const { group, ns, pod, container, message } = msg;
    if (group && ns && pod && container && message !== undefined) {
      if (paused) {
        pauseBuffer.push(msg);
        updatePauseButton();
      } else {
        liveBuffer.push(msg);
        if (!liveRafId) liveRafId = requestAnimationFrame(flushLiveBuffer);
      }
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

// panel:opened fires when a new tab is actually created in panels.js
document.addEventListener('panel:opened', e => {
  const { group, ns, pod, container } = e.detail;
  const key = panelKey(group, ns, pod, container);
  const count = openPanelKeyCounts.get(key) || 0;
  openPanelKeyCounts.set(key, count + 1);
  if (count === 0) {
    wsSend({ type: 'subscribe', group, ns, pod, container });
    updateSidebarItemOpen(key, true);
  }
});

document.addEventListener('panel:closed', e => {
  const { group, ns, pod, container } = e.detail;
  const key = panelKey(group, ns, pod, container);
  const count = openPanelKeyCounts.get(key) || 0;
  if (count <= 1) {
    openPanelKeyCounts.delete(key);
    wsSend({ type: 'unsubscribe', group, ns, pod, container });
    updateSidebarItemOpen(key, false);
  } else {
    openPanelKeyCounts.set(key, count - 1);
  }
});

async function openPodPanel(group, ns, pod, container) {
  const id = openPanel(group, ns, pod, container, () => {});

  // Backfill from history
  try {
    const resp = await fetch(`/api/logs?group=${encodeURIComponent(group)}&ns=${encodeURIComponent(ns)}&pod=${encodeURIComponent(pod)}&container=${encodeURIComponent(container)}&lines=500`);
    const lines = await resp.json();
    if (Array.isArray(lines) && lines.length) {
      prependLines(group, ns, pod, container, lines);
      refreshTimeline();
    }
  } catch { /* ignore — live stream will work regardless */ }

  return id;
}

// ── Sidebar ────────────────────────────────────────────────────────────────

let groups = [];
// Maps panelKey -> sidebar item element; rebuilt only when pod list changes.
const sidebarItems = new Map();

function updateSidebarItemOpen(key, isOpen) {
  sidebarItems.get(key)?.classList.toggle('open', isOpen);
}

function buildSidebar() {
  sidebarItems.clear();
  const list = document.getElementById('pod-list');
  const frag = document.createDocumentFragment();

  if (!groups.length) {
    const empty = document.createElement('div');
    empty.className = 'panel-status';
    empty.textContent = 'No logs discovered yet…';
    frag.appendChild(empty);
    list.replaceChildren(frag);
    return;
  }

  for (const g of groups) {
    const heading = document.createElement('div');
    heading.className = 'pod-group-name';
    heading.textContent = g.name;
    frag.appendChild(heading);

    for (const p of (g.pods || [])) {
      const key = panelKey(g.name, p.namespace, p.pod, p.container);
      const item = document.createElement('div');
      item.className = 'pod-item' + ((openPanelKeyCounts.get(key) || 0) > 0 ? ' open' : '');

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

      sidebarItems.set(key, item);
      frag.appendChild(item);
    }
  }
  list.replaceChildren(frag);
}

async function pollGroups() {
  try {
    const resp = await fetch('/api/groups');
    const data = await resp.json();
    groups = data.groups || [];
    buildSidebar();
  } catch { /* server not ready yet */ }
}

// ── Hash restore ───────────────────────────────────────────────────────────

async function restoreFromHash() {
  const saved = loadState();
  if (!saved || !saved.panelGroups || !saved.panelGroups.length) return;

  restoringState = true;
  const mergedGroupIds = [];
  try {
    if (saved.focus) restoreFocusState(saved.focus);

    const promises = [];
    for (const savedPg of saved.panelGroups) {
      const pg = addPanelGroup();
      for (const t of (savedPg.tabs || [])) {
        const p = openPodPanel(t.group, t.ns, t.pod, t.container);
        if (t.filters && t.filters.length) {
          restoreFilters(t.group, t.ns, t.pod, t.container, t.filters);
        }
        promises.push(p);
      }
      if (savedPg.activeTab) {
        const at = savedPg.activeTab;
        setActivePanelByKey(at.group, at.ns, at.pod, at.container);
      }
      if (savedPg.merged) mergedGroupIds.push(pg.id);
    }

    if (focusState.active) applyFocusToAll();

    await Promise.allSettled(promises);

    // Restore merged view after history has loaded so rebuildMergedView has all lines
    for (const pgId of mergedGroupIds) {
      toggleMergedView(pgId);
    }
  } finally {
    restoringState = false;
  }
}

// ── Theme ──────────────────────────────────────────────────────────────────

const THEME_KEY = 'klogster-theme';
const VALID_THEMES = ['dark', 'light', 'pastel', 'monokai', 'one-dark', 'dracula', 'gruvbox', 'nord', 'zenburn'];

function applyTheme(theme) {
  if (!VALID_THEMES.includes(theme)) theme = 'dark';
  if (theme === 'dark') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
  localStorage.setItem(THEME_KEY, theme);
  document.querySelectorAll('input[name="theme"]').forEach(r => {
    r.checked = r.value === theme;
  });
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY) || 'dark';
  applyTheme(saved);
}

// ── Pause / Resume ─────────────────────────────────────────────────────────

function updatePauseButton() {
  const btn = document.getElementById('btn-pause');
  if (!btn) return;
  if (paused) {
    btn.classList.add('paused');
    btn.textContent = '▶';
    const n = pauseBuffer.length;
    btn.title = n > 0 ? `Resume (${n} lines buffered)` : 'Resume log updates';
  } else {
    btn.classList.remove('paused');
    btn.textContent = '⏸';
    btn.title = 'Pause log updates';
  }
}

function togglePause() {
  paused = !paused;
  if (!paused) {
    const batch = pauseBuffer;
    pauseBuffer = [];
    appendLines(batch);
    refreshTimeline();
  }
  updatePauseButton();
}

// ── Init ───────────────────────────────────────────────────────────────────

function init() {
  initTheme();

  const header = document.getElementById('header');
  const dot = document.createElement('span');
  dot.id = 'conn-status';
  dot.title = 'WebSocket connection';
  header.appendChild(dot);

  initEvents();
  initTimeline();

  const eventsBtn = document.getElementById('btn-events');
  updateEventsBtn(eventsBtn);
  eventsBtn.addEventListener('click', e => openEventsDialog(e.currentTarget));
  document.addEventListener('events:changed', () => {
    updateEventsBtn(eventsBtn);
    // panels.js recomputes event annotations synchronously before this runs,
    // so we can collect fresh data immediately.
    refreshTimelineNow();
  });

  document.getElementById('btn-focus').addEventListener('click', e => {
    openFocusDialog(e.currentTarget);
  });
  document.addEventListener('focus:changed', () => {
    applyFocusToAll();
    maybeSaveState();
  });
  document.addEventListener('panels:state-changed', () => maybeSaveState());

  document.getElementById('btn-pause').addEventListener('click', togglePause);

  document.getElementById('btn-add-panel').addEventListener('click', () => {
    addPanelGroup();
  });

  document.getElementById('btn-open-sidebar').addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('hidden');
  });
  document.getElementById('btn-close-sidebar').addEventListener('click', () => {
    document.getElementById('sidebar').classList.add('hidden');
  });

  function openHelp() {
    document.getElementById('help-dialog').classList.remove('hidden');
    document.getElementById('help-overlay').classList.remove('hidden');
  }
  function closeHelp() {
    document.getElementById('help-dialog').classList.add('hidden');
    document.getElementById('help-overlay').classList.add('hidden');
  }
  document.getElementById('btn-help').addEventListener('click', openHelp);
  document.getElementById('btn-close-help').addEventListener('click', closeHelp);
  document.getElementById('help-overlay').addEventListener('click', closeHelp);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeHelp(); closeConfig(); } });

  function openConfig() {
    document.getElementById('config-dialog').classList.remove('hidden');
    document.getElementById('config-overlay').classList.remove('hidden');
  }
  function closeConfig() {
    document.getElementById('config-dialog').classList.add('hidden');
    document.getElementById('config-overlay').classList.add('hidden');
  }
  document.getElementById('btn-config').addEventListener('click', openConfig);
  document.getElementById('btn-close-config').addEventListener('click', closeConfig);
  document.getElementById('config-overlay').addEventListener('click', closeConfig);
  document.querySelectorAll('input[name="theme"]').forEach(r => {
    r.addEventListener('change', () => applyTheme(r.value));
  });

  initSelectionMenu();
  connectWS();
  pollGroups();
  setInterval(pollGroups, POLL_INTERVAL_MS);
  restoreFromHash();
}

init();
