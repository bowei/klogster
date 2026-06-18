import { attachScrollSync, showCrosshairs, clearCrosshairs } from './timeline.js';
import { focusState, updateFocusCount, lineMatchesFocus, buildFocusHighlightRe } from './focus.js';

const MAX_LINES = 5000;
const PRUNE_TO = 4000;

// ── Data model ────────────────────────────────────────────────────────────────
// panelGroups: array of { id, el, activeTabId, tabs: [tab, ...] }
// tab: { id, group, ns, pod, container, el, logEl, wrapEl, crosshairEl,
//         footerEl, filterBtn, lineCount, lastTs, filters, hasLevel,
//         _scrollLocked, _cleanupScrollSync }

const panelGroups = [];
let nextPanelGroupId = 1;
let nextTabId = 1;
let focusedGroupId = null;

function notifyStateChanged() {
  document.dispatchEvent(new CustomEvent('panels:state-changed'));
}

// ── Utility ───────────────────────────────────────────────────────────────────

function relativeTime(isoTs) {
  if (!isoTs) return '—';
  const secs = (Date.now() - new Date(isoTs).getTime()) / 1000;
  if (secs < 5) return 'just now';
  if (secs < 60) return `${Math.floor(secs)}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

function updateFooter(tab) {
  tab.footerEl.textContent = `${tab.lineCount.toLocaleString()} lines · last: ${relativeTime(tab.lastTs)}`;
}

setInterval(() => {
  for (const pg of panelGroups) {
    for (const tab of pg.tabs) updateFooter(tab);
  }
}, 1000);

function lineVisible(filters, text) {
  for (const f of filters) {
    if (!f.re) continue;
    if (f.type === 'negative' && f.re.test(text)) return false;
    if (f.type === 'positive' && !f.re.test(text)) return false;
  }
  return true;
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlightText(text, re) {
  if (!re) return escapeHtml(text);
  re.lastIndex = 0;
  let result = '';
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    result += escapeHtml(text.slice(last, m.index));
    result += `<mark class="focus-match">${escapeHtml(m[0])}</mark>`;
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++;
  }
  return result + escapeHtml(text.slice(last));
}

function applyHighlight(entry, re) {
  const bodyEl = entry.querySelector('.log-body');
  if (!bodyEl) return;
  for (const child of bodyEl.children) {
    child.innerHTML = highlightText(child.textContent, re);
  }
}

function clearHighlight(entry) {
  const bodyEl = entry.querySelector('.log-body');
  if (!bodyEl) return;
  for (const child of bodyEl.children) {
    if (child.querySelector('.focus-match')) {
      child.textContent = child.textContent;
    }
  }
}

function applyFilters(tab) {
  for (const entry of tab.logEl.querySelectorAll('.log-entry')) {
    const bodyEl = entry.querySelector('.log-body');
    const text = bodyEl ? bodyEl.textContent : entry.textContent;
    entry.style.display = lineVisible(tab.filters, text) ? '' : 'none';
  }
  updateFilterBtn(tab);
}

function applyPanelFocus(tab) {
  const entries = [...tab.logEl.querySelectorAll('.log-entry')];

  if (!focusState.active) {
    for (const entry of entries) clearHighlight(entry);
    applyFilters(tab);
    return;
  }

  const matchIdxs = [];
  entries.forEach((entry, i) => {
    const text = entry.querySelector('.log-body')?.textContent ?? entry.textContent;
    if (lineMatchesFocus(text)) matchIdxs.push(i);
  });
  const matchSet = new Set(matchIdxs);

  const visible = new Set();
  const { contextType, contextAmount, contextDirection } = focusState;
  for (const idx of matchIdxs) {
    visible.add(idx);
    if (contextType === 'line') {
      const before = contextDirection !== 'after'  ? contextAmount : 0;
      const after  = contextDirection !== 'before' ? contextAmount : 0;
      for (let i = Math.max(0, idx - before); i <= Math.min(entries.length - 1, idx + after); i++)
        visible.add(i);
    } else {
      const anchor = new Date(entries[idx].dataset.ts ?? '').getTime();
      if (!anchor) continue;
      const before = contextDirection !== 'after'  ? contextAmount * 1000 : 0;
      const after  = contextDirection !== 'before' ? contextAmount * 1000 : 0;
      for (let i = 0; i < entries.length; i++) {
        const t = new Date(entries[i].dataset.ts ?? '').getTime();
        if (t >= anchor - before && t <= anchor + after) visible.add(i);
      }
    }
  }

  const highlightRe = buildFocusHighlightRe();

  entries.forEach((entry, i) => {
    const text = entry.querySelector('.log-body')?.textContent ?? entry.textContent;
    const show = visible.has(i) && lineVisible(tab.filters, text);
    entry.style.display = show ? '' : 'none';
    if (show && matchSet.has(i)) {
      applyHighlight(entry, highlightRe);
    } else {
      clearHighlight(entry);
    }
  });

  updateFilterBtn(tab);
}

function countFocusMatches() {
  let matchCount = 0;
  let totalCount = 0;
  if (focusState.active) {
    for (const pg of panelGroups) {
      for (const tab of pg.tabs) {
        for (const entry of tab.logEl.querySelectorAll('.log-entry')) {
          totalCount++;
          const text = entry.querySelector('.log-body')?.textContent ?? entry.textContent;
          if (lineMatchesFocus(text)) matchCount++;
        }
      }
    }
    updateFocusCount(matchCount, totalCount);
  }
}

export function applyFocusToAll() {
  for (const pg of panelGroups) {
    for (const tab of pg.tabs) applyPanelFocus(tab);
  }
  countFocusMatches();
}

document.addEventListener('focus:count-request', () => countFocusMatches());

function updateFilterBtn(tab) {
  const n = tab.filters.length;
  tab.filterBtn.textContent = n > 0 ? `filter (${n})` : 'filter';
  tab.filterBtn.classList.toggle('active', n > 0);
  tab.filterBtn.title = n > 0 ? `${n} filter(s) active — click to edit` : 'Add log filters';
}

let activeFilterDialog = null;

function openFilterDialog(tab) {
  const toolbar = tab.el.querySelector('.panel-toolbar');

  if (activeFilterDialog && activeFilterDialog._tabId === tab.id) {
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
  dialog._tabId = tab.id;
  activeFilterDialog = dialog;

  const header = document.createElement('div');
  header.className = 'filter-dialog-header';
  header.textContent = 'Log Filters';

  const listEl = document.createElement('div');
  listEl.className = 'filter-list';

  function renderList() {
    listEl.innerHTML = '';
    if (tab.filters.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'filter-empty';
      empty.textContent = 'No filters yet';
      listEl.appendChild(empty);
      return;
    }
    tab.filters.forEach((f, i) => {
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
        tab.filters.splice(i, 1);
        applyFilters(tab);
        renderList();
        notifyStateChanged();
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
    tab.filters.push({ type: typeSelect.value, pattern, re });
    applyFilters(tab);
    renderList();
    notifyStateChanged();
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
    if (!dialog.contains(e.target) && e.target !== tab.filterBtn) {
      dialog.remove();
      activeFilterDialog = null;
      document.removeEventListener('mousedown', onOutside, true);
    }
  }
  setTimeout(() => document.addEventListener('mousedown', onOutside, true), 0);

  renderList();
  patInput.focus();
}

// ── Log entry building ────────────────────────────────────────────────────────

function formatTs(ts) {
  const date = ts.slice(0, 10);
  const time = ts.slice(11).replace(/Z$|[+-].*$/, '');
  return date + ' ' + time;
}

function buildLogEntry(ts, message, fields, level) {
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

  const lvlEl = document.createElement('span');
  lvlEl.className = 'log-level';
  if (level && level !== 'OTHER') {
    lvlEl.textContent = level;
    lvlEl.dataset.level = level;
  }
  entry.appendChild(lvlEl);

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

function pruneLines(logEl) {
  const entries = logEl.querySelectorAll('.log-entry');
  const toRemove = entries.length - PRUNE_TO;
  for (let i = 0; i < toRemove; i++) {
    entries[i].remove();
  }
}

// ── Panel group helpers ───────────────────────────────────────────────────────

function getFocusedGroup() {
  return panelGroups.find(pg => pg.id === focusedGroupId) || panelGroups[panelGroups.length - 1] || null;
}

function getTabByKey(group, ns, pod, container) {
  for (const pg of panelGroups) {
    const tab = pg.tabs.find(t => t.group === group && t.ns === ns && t.pod === pod && t.container === container);
    if (tab) return { pg, tab };
  }
  return null;
}

function getActivePanels() {
  return panelGroups
    .map(pg => pg.tabs.find(t => t.id === pg.activeTabId))
    .filter(Boolean);
}

function getActiveTabLogEls() {
  return getActivePanels().map(t => t.logEl);
}

function focusGroup(groupId) {
  focusedGroupId = groupId;
}

// ── Tab bar rendering ─────────────────────────────────────────────────────────

let dragSrc = null; // { srcGroupId, tabId }

function renderGroupTabBar(pg) {
  const tabBar = pg.el.querySelector('.panel-group-tabs');
  tabBar.innerHTML = '';

  for (const tab of pg.tabs) {
    const tabEl = document.createElement('div');
    tabEl.className = 'tab' + (tab.id === pg.activeTabId ? ' active' : '');
    tabEl.dataset.tabId = tab.id;
    tabEl.draggable = true;

    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = tab.pod;
    title.title = `${tab.group} / ${tab.ns} / ${tab.pod} / ${tab.container}`;

    const close = document.createElement('button');
    close.className = 'tab-close';
    close.textContent = '✕';
    close.title = 'Close tab';
    close.addEventListener('click', e => {
      e.stopPropagation();
      removeTab(pg.id, tab.id);
    });

    tabEl.appendChild(title);
    tabEl.appendChild(close);
    tabEl.addEventListener('click', () => activateTab(pg.id, tab.id));

    tabEl.addEventListener('dragstart', e => {
      dragSrc = { srcGroupId: pg.id, tabId: tab.id };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', JSON.stringify(dragSrc));
    });
    tabEl.addEventListener('dragover', e => {
      if (!dragSrc) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      tabEl.classList.add('drag-over');
    });
    tabEl.addEventListener('dragleave', () => tabEl.classList.remove('drag-over'));
    tabEl.addEventListener('drop', e => {
      e.preventDefault();
      e.stopPropagation();
      tabEl.classList.remove('drag-over');
      if (!dragSrc) return;
      const { srcGroupId, tabId: srcTabId } = dragSrc;
      if (srcGroupId === pg.id && srcTabId === tab.id) { dragSrc = null; return; }
      moveTab(srcGroupId, srcTabId, pg.id, tab.id);
      dragSrc = null;
    });
    tabEl.addEventListener('dragend', () => { dragSrc = null; });

    tabBar.appendChild(tabEl);
  }
}

// ── Panel group management ────────────────────────────────────────────────────

export function addPanelGroup() {
  const pgId = nextPanelGroupId++;
  const el = document.createElement('div');
  el.className = 'panel-group';
  el.dataset.groupId = pgId;

  const tabBar = document.createElement('div');
  tabBar.className = 'panel-group-tabs';

  // Drop zone on empty tab bar space (append to this group)
  tabBar.addEventListener('dragover', e => {
    if (!dragSrc) return;
    if (e.target.closest('.tab')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    tabBar.classList.add('drag-over');
  });
  tabBar.addEventListener('dragleave', e => {
    if (!tabBar.contains(e.relatedTarget)) tabBar.classList.remove('drag-over');
  });
  tabBar.addEventListener('drop', e => {
    tabBar.classList.remove('drag-over');
    if (!dragSrc) return;
    if (e.target.closest('.tab')) return; // handled by tab's drop listener
    e.preventDefault();
    const { srcGroupId, tabId: srcTabId } = dragSrc;
    const pg = panelGroups.find(g => g.id === pgId);
    if (!pg) { dragSrc = null; return; }
    moveTab(srcGroupId, srcTabId, pgId, null);
    dragSrc = null;
  });

  el.appendChild(tabBar);

  // Clicking anywhere in this panel group focuses it
  el.addEventListener('mousedown', () => focusGroup(pgId));

  const pg = { id: pgId, el, activeTabId: null, tabs: [] };
  panelGroups.push(pg);
  document.getElementById('panels-container').appendChild(el);
  focusGroup(pgId);
  return pg;
}

function removePanelGroup(pgId) {
  const idx = panelGroups.findIndex(g => g.id === pgId);
  if (idx < 0) return;
  const [pg] = panelGroups.splice(idx, 1);
  pg.el.remove();

  if (panelGroups.length > 0) {
    focusGroup(panelGroups[Math.min(idx, panelGroups.length - 1)].id);
  } else {
    focusedGroupId = null;
  }
}

// ── Tab management ────────────────────────────────────────────────────────────

function activateTab(groupId, tabId) {
  const pg = panelGroups.find(g => g.id === groupId);
  if (!pg) return;
  pg.activeTabId = tabId;

  for (const tab of pg.tabs) {
    tab.el.classList.toggle('tab-inactive', tab.id !== tabId);
  }

  renderGroupTabBar(pg);
  focusGroup(groupId);
  notifyStateChanged();
}

function removeTab(groupId, tabId) {
  const pg = panelGroups.find(g => g.id === groupId);
  if (!pg) return;

  const idx = pg.tabs.findIndex(t => t.id === tabId);
  if (idx < 0) return;

  const [tab] = pg.tabs.splice(idx, 1);
  if (tab._cleanupScrollSync) tab._cleanupScrollSync();
  tab.el.remove();

  document.dispatchEvent(new CustomEvent('panel:closed', {
    detail: { id: tab.id, group: tab.group, ns: tab.ns, pod: tab.pod, container: tab.container }
  }));

  if (pg.tabs.length === 0) {
    removePanelGroup(pg.id);
  } else {
    if (pg.activeTabId === tabId) {
      const next = pg.tabs[Math.min(idx, pg.tabs.length - 1)];
      pg.activeTabId = next.id;
      for (const t of pg.tabs) t.el.classList.toggle('tab-inactive', t.id !== pg.activeTabId);
    }
    renderGroupTabBar(pg);
  }
  notifyStateChanged();
}

function moveTab(srcGroupId, tabId, dstGroupId, beforeTabId) {
  const srcPg = panelGroups.find(g => g.id === srcGroupId);
  const dstPg = panelGroups.find(g => g.id === dstGroupId);
  if (!srcPg || !dstPg) return;

  const srcIdx = srcPg.tabs.findIndex(t => t.id === tabId);
  if (srcIdx < 0) return;

  const [tab] = srcPg.tabs.splice(srcIdx, 1);

  // Fix source group after removal
  const srcWasActive = srcPg.activeTabId === tabId;
  if (srcPg.tabs.length === 0) {
    removePanelGroup(srcPg.id);
  } else {
    if (srcWasActive) {
      const next = srcPg.tabs[Math.min(srcIdx, srcPg.tabs.length - 1)];
      srcPg.activeTabId = next.id;
      for (const t of srcPg.tabs) t.el.classList.toggle('tab-inactive', t.id !== srcPg.activeTabId);
    }
    renderGroupTabBar(srcPg);
  }

  // Insert into destination group
  if (beforeTabId == null) {
    dstPg.tabs.push(tab);
  } else {
    const dstIdx = dstPg.tabs.findIndex(t => t.id === beforeTabId);
    dstPg.tabs.splice(dstIdx >= 0 ? dstIdx : dstPg.tabs.length, 0, tab);
  }

  // Move panel DOM element into new group
  tab.el.remove();
  dstPg.el.appendChild(tab.el);

  activateTab(dstGroupId, tabId);
  notifyStateChanged();
}

// ── Open / close panel ────────────────────────────────────────────────────────

export function openPanel(group, ns, pod, container, _onClose) {
  const focusedPg = getFocusedGroup();

  // If already open in focused group, just activate it
  if (focusedPg) {
    const existing = focusedPg.tabs.find(t =>
      t.group === group && t.ns === ns && t.pod === pod && t.container === container);
    if (existing) {
      activateTab(focusedPg.id, existing.id);
      return existing.id;
    }
  }

  const pg = focusedPg || addPanelGroup();
  const tabId = nextTabId++;

  // Build panel DOM
  const el = document.createElement('div');
  el.className = 'panel';
  el.dataset.tabId = tabId;

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

  const footerEl = document.createElement('div');
  footerEl.className = 'panel-footer';
  footerEl.textContent = '0 lines · last: —';

  el.appendChild(toolbar);
  el.appendChild(wrapEl);
  el.appendChild(footerEl);

  const tab = {
    id: tabId, group, ns, pod, container,
    el, logEl, wrapEl, crosshairEl, footerEl, filterBtn,
    lineCount: 0, lastTs: null, filters: [], hasLevel: false,
  };

  pg.tabs.push(tab);
  pg.el.appendChild(tab.el);

  filterBtn.addEventListener('click', () => openFilterDialog(tab));

  tab._cleanupScrollSync = attachScrollSync(logEl, getActiveTabLogEls, () => logEl._scrollLocked);

  logEl.addEventListener('mouseover', e => {
    const line = e.target.closest('.log-entry[data-ts]');
    if (!line) return;
    showCrosshairs(line.dataset.ts, tab, getActivePanels());
  });
  logEl.addEventListener('mouseleave', () => clearCrosshairs(getActivePanels()));

  document.dispatchEvent(new CustomEvent('panel:opened', {
    detail: { id: tabId, group, ns, pod, container }
  }));

  activateTab(pg.id, tabId);
  return tabId;
}

export function closePanel(id) {
  for (const pg of panelGroups) {
    const tab = pg.tabs.find(t => t.id === id);
    if (tab) { removeTab(pg.id, id); return; }
  }
}

// ── Log line ingestion ────────────────────────────────────────────────────────

export function appendLine(group, ns, pod, container, ts, message, fields, level) {
  const result = getTabByKey(group, ns, pod, container);
  if (!result) return;
  const { tab } = result;
  const { logEl } = tab;

  const pg = panelGroups.find(g => g.id === result.pg.id);
  const isActive = pg && pg.activeTabId === tab.id;
  const atBottom = isActive
    ? logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40
    : true; // always track bottom for hidden tabs

  const entry = buildLogEntry(ts, message, fields, level || '');
  if (!tab.hasLevel && level && level !== 'OTHER') {
    tab.hasLevel = true;
    tab.el.classList.add('has-level');
  }
  const bodyEl = entry.querySelector('.log-body');
  const text = bodyEl ? bodyEl.textContent : message || '';
  const panelVisible = lineVisible(tab.filters, text);
  const matches = focusState.active && lineMatchesFocus(text);
  const focusVisible = !focusState.active || matches;
  if (!panelVisible || !focusVisible) {
    entry.style.display = 'none';
  } else if (matches) {
    applyHighlight(entry, buildFocusHighlightRe());
  }

  logEl.appendChild(entry);
  tab.lineCount++;
  if (ts) tab.lastTs = ts;
  updateFooter(tab);

  if (tab.lineCount > MAX_LINES) {
    pruneLines(logEl);
    tab.lineCount = PRUNE_TO;
  }

  if (isActive && atBottom) {
    logEl.scrollTop = logEl.scrollHeight;
  }
}

export function prependLines(group, ns, pod, container, lines) {
  const result = getTabByKey(group, ns, pod, container);
  if (!result || !lines.length) return;
  const { tab } = result;
  const { logEl } = tab;

  const frag = document.createDocumentFragment();

  for (const line of lines) {
    const entry = buildLogEntry(line.ts || '', line.message || '', line.fields || null, line.level || '');
    frag.appendChild(entry);
  }

  if (!tab.hasLevel && lines.some(l => l.level && l.level !== 'OTHER')) {
    tab.hasLevel = true;
    tab.el.classList.add('has-level');
  }

  logEl.insertBefore(frag, logEl.firstChild);
  tab.lineCount += lines.length;
  if (tab.lineCount > MAX_LINES) {
    pruneLines(logEl);
    tab.lineCount = PRUNE_TO;
  }

  if (!tab.lastTs) {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].ts) { tab.lastTs = lines[i].ts; break; }
    }
  }
  updateFooter(tab);
  applyPanelFocus(tab);
}

// ── State serialization ───────────────────────────────────────────────────────

export function getPanelIds() {
  return panelGroups.flatMap(pg =>
    pg.tabs.map(t => ({ id: t.id, group: t.group, ns: t.ns, pod: t.pod, container: t.container }))
  );
}

export function getSerializableState() {
  return panelGroups.map(pg => {
    const activeTab = pg.tabs.find(t => t.id === pg.activeTabId);
    return {
      activeTab: activeTab
        ? { group: activeTab.group, ns: activeTab.ns, pod: activeTab.pod, container: activeTab.container }
        : null,
      tabs: pg.tabs.map(t => ({
        group: t.group, ns: t.ns, pod: t.pod, container: t.container,
        filters: t.filters.map(f => ({ type: f.type, pattern: f.pattern })),
      })),
    };
  });
}

export function restoreFilters(group, ns, pod, container, filters) {
  const result = getTabByKey(group, ns, pod, container);
  if (!result) return;
  const { tab } = result;
  tab.filters = filters.map(f => {
    let re = null;
    try { re = new RegExp(f.pattern, 'i'); } catch {}
    return { type: f.type, pattern: f.pattern, re };
  });
  applyFilters(tab);
}

export function setActivePanelByKey(group, ns, pod, container) {
  const result = getTabByKey(group, ns, pod, container);
  if (result) activateTab(result.pg.id, result.tab.id);
}
