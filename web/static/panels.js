import { attachScrollSync } from './timeline.js';

const MAX_LINES = 5000;
const PRUNE_TO = 4000;

// panels: [{id, group, ns, pod, logEl, locked}]
const panels = [];
let nextId = 1;

let dragSrcId = null;

function getAllLogEls() {
  return panels.map(p => p.logEl);
}

function renderTabBar() {
  const bar = document.getElementById('tab-bar');
  bar.innerHTML = '';
  for (const p of panels) {
    const tab = document.createElement('div');
    tab.className = 'tab' + (p.active ? ' active' : '');
    tab.dataset.panelId = p.id;
    tab.draggable = true;

    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = p.pod;
    title.title = `${p.group} / ${p.ns} / ${p.pod}`;

    const close = document.createElement('button');
    close.className = 'tab-close';
    close.textContent = '✕';
    close.title = 'Close panel';
    close.addEventListener('click', e => {
      e.stopPropagation();
      removePanel(p.id);
    });

    tab.appendChild(title);
    tab.appendChild(close);
    tab.addEventListener('click', () => activatePanel(p.id));

    tab.addEventListener('dragstart', e => {
      dragSrcId = p.id;
      e.dataTransfer.effectAllowed = 'move';
    });
    tab.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      tab.classList.add('drag-over');
    });
    tab.addEventListener('dragleave', () => tab.classList.remove('drag-over'));
    tab.addEventListener('drop', e => {
      e.preventDefault();
      tab.classList.remove('drag-over');
      if (dragSrcId == null || dragSrcId === p.id) return;
      const srcIdx = panels.findIndex(x => x.id === dragSrcId);
      const dstIdx = panels.findIndex(x => x.id === p.id);
      if (srcIdx < 0 || dstIdx < 0) return;
      const [moved] = panels.splice(srcIdx, 1);
      panels.splice(dstIdx, 0, moved);
      dragSrcId = null;
      renderAll();
    });
    tab.addEventListener('dragend', () => { dragSrcId = null; });

    bar.appendChild(tab);
  }
}

function renderPanelContainer() {
  const container = document.getElementById('panels-container');
  // Sync DOM order with panels array
  container.innerHTML = '';
  for (const p of panels) {
    container.appendChild(p.el);
  }
}

function renderAll() {
  renderTabBar();
  renderPanelContainer();
}

function activatePanel(id) {
  for (const p of panels) p.active = (p.id === id);
  renderTabBar();
}

/**
 * Open a new panel for a pod. Returns the panel id.
 * onClose(id) is called when the panel is removed.
 */
export function openPanel(group, ns, pod, onClose) {
  const existing = panels.find(p => p.group === group && p.ns === ns && p.pod === pod);
  if (existing) {
    activatePanel(existing.id);
    return existing.id;
  }

  const id = nextId++;

  // Outer panel element
  const el = document.createElement('div');
  el.className = 'panel';
  el.dataset.panelId = id;

  // Toolbar
  const toolbar = document.createElement('div');
  toolbar.className = 'panel-toolbar';

  const label = document.createElement('span');
  label.className = 'panel-label';
  label.textContent = `${group} / ${ns} / ${pod}`;
  label.title = label.textContent;

  const lockBtn = document.createElement('button');
  lockBtn.className = 'btn-lock-scroll';
  lockBtn.textContent = '⟷ sync';
  lockBtn.title = 'Toggle timestamp scroll sync';

  toolbar.appendChild(label);
  toolbar.appendChild(lockBtn);

  // Log area
  const logEl = document.createElement('div');
  logEl.className = 'panel-log';
  logEl._scrollLocked = true;

  lockBtn.addEventListener('click', () => {
    logEl._scrollLocked = !logEl._scrollLocked;
    lockBtn.classList.toggle('unlocked', !logEl._scrollLocked);
    lockBtn.textContent = logEl._scrollLocked ? '⟷ sync' : '⟷ free';
  });

  el.appendChild(toolbar);
  el.appendChild(logEl);

  const panel = { id, group, ns, pod, el, logEl, active: true, lineCount: 0 };
  for (const p of panels) p.active = false;
  panels.push(panel);

  attachScrollSync(logEl, getAllLogEls, () => logEl._scrollLocked);

  renderAll();

  return id;
}

export function closePanel(id) {
  removePanel(id);
}

function removePanel(id) {
  const idx = panels.findIndex(p => p.id === id);
  if (idx < 0) return;
  const [p] = panels.splice(idx, 1);
  p.el.remove();

  if (panels.length > 0 && !panels.some(x => x.active)) {
    panels[Math.min(idx, panels.length - 1)].active = true;
  }
  renderTabBar();

  // Notify app to unsubscribe
  document.dispatchEvent(new CustomEvent('panel:closed', { detail: { id, group: p.group, ns: p.ns, pod: p.pod } }));
}

/**
 * Append a log line to the panel identified by (group, ns, pod).
 *
 * @param {string} group
 * @param {string} ns
 * @param {string} pod
 * @param {string} ts   - ISO timestamp (may be empty string)
 * @param {string} text - full raw line text
 */
export function appendLine(group, ns, pod, ts, text) {
  const p = panels.find(x => x.group === group && x.ns === ns && x.pod === pod);
  if (!p) return;

  const { logEl } = p;
  const atBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;

  const span = document.createElement('span');
  span.className = 'log-line';
  if (ts) span.dataset.ts = ts;

  if (ts) {
    const tsSpan = document.createElement('span');
    tsSpan.className = 'log-ts';
    // Show only time portion for brevity; full ts in data-ts for sync
    tsSpan.textContent = ts.slice(11, 23); // HH:MM:SS.mmm
    tsSpan.title = ts;
    span.appendChild(tsSpan);
  }

  const textNode = document.createTextNode(ts ? text.slice(ts.length + 1) : text);
  span.appendChild(textNode);

  logEl.appendChild(span);
  p.lineCount++;

  if (p.lineCount > MAX_LINES) {
    pruneLines(logEl);
    p.lineCount = PRUNE_TO;
  }

  if (atBottom) {
    logEl.scrollTop = logEl.scrollHeight;
  }
}

function pruneLines(logEl) {
  const spans = logEl.querySelectorAll('.log-line');
  const toRemove = spans.length - PRUNE_TO;
  for (let i = 0; i < toRemove; i++) {
    spans[i].remove();
  }
}

/**
 * Prepend backfill lines (history) to a panel. Lines are oldest-first.
 */
export function prependLines(group, ns, pod, lines) {
  const p = panels.find(x => x.group === group && x.ns === ns && x.pod === pod);
  if (!p || !lines.length) return;

  const { logEl } = p;
  const frag = document.createDocumentFragment();

  for (const rawLine of lines) {
    const ts = extractTimestamp(rawLine);
    const span = document.createElement('span');
    span.className = 'log-line';
    if (ts) span.dataset.ts = ts;

    if (ts) {
      const tsSpan = document.createElement('span');
      tsSpan.className = 'log-ts';
      tsSpan.textContent = ts.slice(11, 23);
      tsSpan.title = ts;
      span.appendChild(tsSpan);
      span.appendChild(document.createTextNode(rawLine.slice(ts.length + 1)));
    } else {
      span.appendChild(document.createTextNode(rawLine));
    }
    frag.appendChild(span);
  }

  logEl.insertBefore(frag, logEl.firstChild);
  p.lineCount += lines.length;
  if (p.lineCount > MAX_LINES) {
    pruneLines(logEl);
    p.lineCount = PRUNE_TO;
  }
}

function extractTimestamp(line) {
  const idx = line.indexOf(' ');
  if (idx < 0) return '';
  const candidate = line.slice(0, idx);
  // Quick sanity: ISO timestamps start with a digit
  if (candidate.length < 20 || !/^\d/.test(candidate)) return '';
  return candidate;
}

export function getPanelIds() {
  return panels.map(p => ({ id: p.id, group: p.group, ns: p.ns, pod: p.pod }));
}
