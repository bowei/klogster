import { attachScrollSync, showCrosshairs, clearCrosshairs } from './timeline.js';

const MAX_LINES = 5000;
const PRUNE_TO = 4000;

function relativeTime(isoTs) {
  if (!isoTs) return '—';
  const secs = (Date.now() - new Date(isoTs).getTime()) / 1000;
  if (secs < 5) return 'just now';
  if (secs < 60) return `${Math.floor(secs)}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

function updateFooter(p) {
  p.footerEl.textContent = `${p.lineCount.toLocaleString()} lines · last: ${relativeTime(p.lastTs)}`;
}

setInterval(() => { for (const p of panels) updateFooter(p); }, 1000);

// panels: [{id, group, ns, pod, container, logEl, locked, filters, filterBtn}]
const panels = [];
let nextId = 1;

function lineVisible(filters, text) {
  for (const f of filters) {
    if (!f.re) continue;
    if (f.type === 'negative' && f.re.test(text)) return false;
    if (f.type === 'positive' && !f.re.test(text)) return false;
  }
  return true;
}

function applyFilters(p) {
  for (const entry of p.logEl.querySelectorAll('.log-entry')) {
    const bodyEl = entry.querySelector('.log-body');
    const text = bodyEl ? bodyEl.textContent : entry.textContent;
    entry.style.display = lineVisible(p.filters, text) ? '' : 'none';
  }
  updateFilterBtn(p);
}

function updateFilterBtn(p) {
  const n = p.filters.length;
  p.filterBtn.textContent = n > 0 ? `filter (${n})` : 'filter';
  p.filterBtn.classList.toggle('active', n > 0);
  p.filterBtn.title = n > 0 ? `${n} filter(s) active — click to edit` : 'Add log filters';
}

let activeFilterDialog = null;

function openFilterDialog(p) {
  const toolbar = p.el.querySelector('.panel-toolbar');

  if (activeFilterDialog && activeFilterDialog._panelId === p.id) {
    activeFilterDialog.remove();
    activeFilterDialog = null;
    return;
  }
  if (activeFilterDialog) {
    activeFilterDialog.remove();
    activeFilterDialog = null;
  }

  const dialog = document.createElement('div');
  dialog.className = 'filter-dialog';
  dialog._panelId = p.id;
  activeFilterDialog = dialog;

  const header = document.createElement('div');
  header.className = 'filter-dialog-header';
  header.textContent = 'Log Filters';

  const listEl = document.createElement('div');
  listEl.className = 'filter-list';

  function renderList() {
    listEl.innerHTML = '';
    if (p.filters.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'filter-empty';
      empty.textContent = 'No filters yet';
      listEl.appendChild(empty);
      return;
    }
    p.filters.forEach((f, i) => {
      const item = document.createElement('div');
      item.className = 'filter-item';

      const badge = document.createElement('span');
      badge.className = `filter-badge ${f.type === 'positive' ? 'filter-badge-pos' : 'filter-badge-neg'}`;
      badge.textContent = f.type === 'positive' ? '+' : '−';
      badge.title = f.type === 'positive' ? 'show only matching' : 'hide matching';

      const pat = document.createElement('span');
      pat.className = 'filter-pattern' + (f.re ? '' : ' filter-pattern-invalid');
      pat.textContent = f.pattern;
      pat.title = f.re ? f.pattern : `Invalid regexp: ${f.pattern}`;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'filter-remove';
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => {
        p.filters.splice(i, 1);
        applyFilters(p);
        renderList();
      });

      item.appendChild(badge);
      item.appendChild(pat);
      item.appendChild(removeBtn);
      listEl.appendChild(item);
    });
  }

  const addRow = document.createElement('div');
  addRow.className = 'filter-add-row';

  const typeSelect = document.createElement('select');
  typeSelect.className = 'filter-type-select';
  [['positive', '+ show'], ['negative', '− hide']].forEach(([v, t]) => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = t;
    typeSelect.appendChild(opt);
  });

  const patInput = document.createElement('input');
  patInput.type = 'text';
  patInput.className = 'filter-pattern-input';
  patInput.placeholder = 'regexp pattern…';
  patInput.spellcheck = false;

  const addBtn = document.createElement('button');
  addBtn.className = 'filter-add-btn';
  addBtn.textContent = 'Add';

  function doAdd() {
    const pattern = patInput.value.trim();
    if (!pattern) return;
    let re = null;
    try { re = new RegExp(pattern, 'i'); } catch (_) {}
    p.filters.push({ type: typeSelect.value, pattern, re });
    applyFilters(p);
    renderList();
    patInput.value = '';
    patInput.focus();
  }

  addBtn.addEventListener('click', doAdd);
  patInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') doAdd();
    if (e.key === 'Escape') { dialog.remove(); activeFilterDialog = null; }
  });

  addRow.appendChild(typeSelect);
  addRow.appendChild(patInput);
  addRow.appendChild(addBtn);

  dialog.appendChild(header);
  dialog.appendChild(listEl);
  dialog.appendChild(addRow);
  toolbar.appendChild(dialog);

  function onOutside(e) {
    if (!dialog.contains(e.target) && e.target !== p.filterBtn) {
      dialog.remove();
      activeFilterDialog = null;
      document.removeEventListener('mousedown', onOutside, true);
    }
  }
  setTimeout(() => document.addEventListener('mousedown', onOutside, true), 0);

  renderList();
  patInput.focus();
}

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
    title.title = `${p.group} / ${p.ns} / ${p.pod} / ${p.container}`;

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
 * Open a new panel for a pod/container. Returns the panel id.
 * onClose(id) is called when the panel is removed.
 */
export function openPanel(group, ns, pod, container, onClose) {
  const existing = panels.find(p => p.group === group && p.ns === ns && p.pod === pod && p.container === container);
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
  label.textContent = `${group} / ${ns} / ${pod} / ${container}`;
  label.title = label.textContent;

  const lockBtn = document.createElement('button');
  lockBtn.className = 'btn-lock-scroll';
  lockBtn.textContent = '⟷ sync';
  lockBtn.title = 'Toggle timestamp scroll sync';

  const filterBtn = document.createElement('button');
  filterBtn.className = 'btn-filter';
  filterBtn.textContent = 'filter';
  filterBtn.title = 'Add log filters';

  toolbar.appendChild(label);
  toolbar.appendChild(filterBtn);
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

  const crosshairEl = document.createElement('div');
  crosshairEl.className = 'ts-crosshair';

  const wrapEl = document.createElement('div');
  wrapEl.className = 'panel-log-wrap';
  wrapEl.appendChild(logEl);
  wrapEl.appendChild(crosshairEl);

  // Footer
  const footerEl = document.createElement('div');
  footerEl.className = 'panel-footer';
  footerEl.textContent = '0 lines · last: —';

  el.appendChild(toolbar);
  el.appendChild(wrapEl);
  el.appendChild(footerEl);

  const panel = { id, group, ns, pod, container, el, logEl, wrapEl, crosshairEl, footerEl, filterBtn, active: true, lineCount: 0, lastTs: null, filters: [] };
  for (const p of panels) p.active = false;
  panels.push(panel);

  filterBtn.addEventListener('click', () => openFilterDialog(panel));

  attachScrollSync(logEl, getAllLogEls, () => logEl._scrollLocked);

  logEl.addEventListener('mouseover', e => {
    const line = e.target.closest('.log-entry[data-ts]');
    if (!line) return;
    showCrosshairs(line.dataset.ts, panel, panels);
  });
  logEl.addEventListener('mouseleave', () => clearCrosshairs(panels));

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
  document.dispatchEvent(new CustomEvent('panel:closed', { detail: { id, group: p.group, ns: p.ns, pod: p.pod, container: p.container } }));
}

function formatTs(ts) {
  // ts is RFC3339Nano e.g. "2024-01-16T10:00:00.123456789Z"
  // Returns "2024-01-16 10:00:00.123456789" (no T, no timezone suffix)
  const date = ts.slice(0, 10);
  const time = ts.slice(11).replace(/Z$|[+-].*$/, '');
  return date + ' ' + time;
}

function buildLogEntry(ts, message, fields) {
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  if (ts) entry.dataset.ts = ts;

  const tsEl = document.createElement('span');
  tsEl.className = 'log-ts';
  if (ts) {
    tsEl.textContent = formatTs(ts);
    tsEl.title = ts;
  }
  entry.appendChild(tsEl);

  const bodyEl = document.createElement('div');
  bodyEl.className = 'log-body';

  const msgEl = document.createElement('div');
  msgEl.className = 'log-msg';
  msgEl.textContent = message || '';
  bodyEl.appendChild(msgEl);

  if (fields) {
    for (const key of Object.keys(fields).sort()) {
      const fieldEl = document.createElement('div');
      fieldEl.className = 'log-field';
      fieldEl.textContent = `${key}: ${fields[key]}`;
      bodyEl.appendChild(fieldEl);
    }
  }

  entry.appendChild(bodyEl);
  return entry;
}

/**
 * Append a log line to the panel identified by (group, ns, pod, container).
 */
export function appendLine(group, ns, pod, container, ts, message, fields) {
  const p = panels.find(x => x.group === group && x.ns === ns && x.pod === pod && x.container === container);
  if (!p) return;

  const { logEl } = p;
  const atBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;

  const entry = buildLogEntry(ts, message, fields);
  const bodyEl = entry.querySelector('.log-body');
  if (!lineVisible(p.filters, bodyEl ? bodyEl.textContent : message || '')) entry.style.display = 'none';

  logEl.appendChild(entry);
  p.lineCount++;
  if (ts) p.lastTs = ts;
  updateFooter(p);

  if (p.lineCount > MAX_LINES) {
    pruneLines(logEl);
    p.lineCount = PRUNE_TO;
  }

  if (atBottom) {
    logEl.scrollTop = logEl.scrollHeight;
  }
}

function pruneLines(logEl) {
  const entries = logEl.querySelectorAll('.log-entry');
  const toRemove = entries.length - PRUNE_TO;
  for (let i = 0; i < toRemove; i++) {
    entries[i].remove();
  }
}

/**
 * Prepend backfill lines (history) to a panel. Lines are oldest-first.
 * Each line is {ts, message, fields} as returned by /api/logs.
 */
export function prependLines(group, ns, pod, container, lines) {
  const p = panels.find(x => x.group === group && x.ns === ns && x.pod === pod && x.container === container);
  if (!p || !lines.length) return;

  const { logEl } = p;
  const frag = document.createDocumentFragment();

  for (const line of lines) {
    const entry = buildLogEntry(line.ts || '', line.message || '', line.fields || null);
    const bodyEl = entry.querySelector('.log-body');
    if (!lineVisible(p.filters, bodyEl ? bodyEl.textContent : line.message || '')) entry.style.display = 'none';
    frag.appendChild(entry);
  }

  logEl.insertBefore(frag, logEl.firstChild);
  p.lineCount += lines.length;
  if (p.lineCount > MAX_LINES) {
    pruneLines(logEl);
    p.lineCount = PRUNE_TO;
  }

  if (!p.lastTs) {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].ts) { p.lastTs = lines[i].ts; break; }
    }
  }
  updateFooter(p);
}

export function getPanelIds() {
  return panels.map(p => ({ id: p.id, group: p.group, ns: p.ns, pod: p.pod, container: p.container }));
}
