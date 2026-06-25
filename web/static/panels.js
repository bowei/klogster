import { attachScrollSync, showCrosshairs, clearCrosshairs } from './timeline.js';
import { focusState, updateFocusCount, lineMatchesFocus, buildFocusHighlightRe } from './focus.js';
import { eventsState, matchAndAnnotate, clearEntryEvents, applyActiveDurations, rebuildActiveRanges } from './events.js';

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

function relativeTime(ms) {
  if (!ms) return '—';
  const secs = (Date.now() - ms) / 1000;
  if (secs < 5) return 'just now';
  if (secs < 60) return `${Math.floor(secs)}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

function updateFooter(tab) {
  tab.footerEl.textContent = `${tab.lineCount.toLocaleString()} lines · last: ${relativeTime(tab.lastTsMs)}`;
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
  // Propagate to merged view if this tab's group is currently merged
  const pg = panelGroups.find(g => g.tabs.includes(tab));
  if (pg && pg.merged) applyMergedFilters(pg);
}

// ── Merged view helpers ───────────────────────────────────────────────────────

function applyMergedFilters(pg) {
  const tabById = new Map(pg.tabs.map(t => [t.id, t]));
  for (const { el, tabId } of pg.mergedEntries) {
    const srcTab = tabById.get(tabId);
    if (!srcTab) { el.style.display = 'none'; continue; }
    const bodyEl = el.querySelector('.log-body');
    const text = bodyEl ? bodyEl.textContent : '';
    el.style.display = lineVisible(srcTab.filters, text) ? '' : 'none';
  }
}

function makeMergedEntry(tab, srcEntry) {
  const clone = srcEntry.cloneNode(true);
  clone.dataset.srcTabId = tab.id;

  const srcLabel = document.createElement('span');
  srcLabel.className = 'log-source';
  srcLabel.textContent = `${tab.pod}/${tab.container}`;
  clone.insertBefore(srcLabel, clone.querySelector('.log-body'));

  // Recompute visibility from source tab's filters (ignore focus-based display from source)
  const bodyEl = clone.querySelector('.log-body');
  const text = bodyEl ? bodyEl.textContent : '';
  clone.style.display = lineVisible(tab.filters, text) ? '' : 'none';

  return clone;
}

function rebuildMergedView(pg) {
  const mergedLogEl = pg.mergedLogEl;
  mergedLogEl.innerHTML = '';

  // Collect entries; logEl.children avoids allocating a filtered NodeList.
  const all = [];
  for (const tab of pg.tabs) {
    for (const entry of tab.logEl.children) {
      all.push({ ts: entry.dataset.ts || '', tab, entry });
    }
  }

  // Sort chronologically; entries without timestamps go to the end
  all.sort((a, b) => {
    if (!a.ts && !b.ts) return 0;
    if (!a.ts) return 1;
    if (!b.ts) return -1;
    return a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0;
  });

  const frag = document.createDocumentFragment();
  pg.mergedEntries = [];
  for (const { ts, tab, entry } of all) {
    const clone = makeMergedEntry(tab, entry);
    frag.appendChild(clone);
    pg.mergedEntries.push({ ts, el: clone, tabId: tab.id });
  }
  mergedLogEl.appendChild(frag);

  pg.mergedEl.querySelector('.panel-footer').textContent = `${all.length.toLocaleString()} lines (merged)`;
  mergedLogEl.scrollTop = mergedLogEl.scrollHeight;
}

// Merge-sort srcEntries (DOM elements from tab.logEl, already in chronological
// order) into the existing sorted pg.mergedEntries without a full rebuild.
// Used by prependLines to insert historical data while merged view is live.
function mergeIntoMergedView(pg, tab, srcEntries) {
  const mergedLogEl = pg.mergedLogEl;
  const wasAtBottom = mergedLogEl.scrollHeight - mergedLogEl.scrollTop - mergedLogEl.clientHeight < 40;

  const newItems = srcEntries.map(e => ({
    ts: e.dataset.ts || '', el: makeMergedEntry(tab, e), tabId: tab.id,
  }));

  // Two-pointer merge of two sorted arrays (no-ts entries sort to the end).
  const existing = pg.mergedEntries;
  const merged = [];
  let ei = 0, ni = 0;
  while (ei < existing.length && ni < newItems.length) {
    const ets = existing[ei].ts, nts = newItems[ni].ts;
    const takeExisting = !ets ? false : !nts ? true : ets <= nts;
    merged.push(takeExisting ? existing[ei++] : newItems[ni++]);
  }
  while (ei < existing.length) merged.push(existing[ei++]);
  while (ni < newItems.length) merged.push(newItems[ni++]);

  // Move all elements into a fragment (detaches existing from mergedLogEl),
  // then replace children in one DOM mutation.
  const frag = document.createDocumentFragment();
  for (const item of merged) frag.appendChild(item.el);
  mergedLogEl.replaceChildren(frag);

  pg.mergedEntries = merged;
  if (wasAtBottom) mergedLogEl.scrollTop = mergedLogEl.scrollHeight;
  pg.mergedEl.querySelector('.panel-footer').textContent = `${merged.length.toLocaleString()} lines (merged)`;
}

function appendToMergedView(pg, tab, ts, srcEntry) {
  const clone = makeMergedEntry(tab, srcEntry);
  const mergedLogEl = pg.mergedLogEl;
  const wasAtBottom = mergedLogEl.scrollHeight - mergedLogEl.scrollTop - mergedLogEl.clientHeight < 40;

  if (!ts) {
    mergedLogEl.appendChild(clone);
    pg.mergedEntries.push({ ts: '', el: clone, tabId: tab.id });
  } else {
    // Binary-search the JS array — no DOM query needed.
    const arr = pg.mergedEntries;
    let lo = 0, hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((arr[mid].ts || '') <= ts) lo = mid + 1;
      else hi = mid;
    }
    mergedLogEl.insertBefore(clone, arr[lo]?.el ?? null);
    arr.splice(lo, 0, { ts, el: clone, tabId: tab.id });
  }

  if (wasAtBottom) mergedLogEl.scrollTop = mergedLogEl.scrollHeight;

  pg.mergedEl.querySelector('.panel-footer').textContent =
    `${pg.mergedEntries.length.toLocaleString()} lines (merged)`;
}

export function toggleMergedView(pgId, activateTabId = null) {
  const pg = panelGroups.find(g => g.id === pgId);
  if (!pg) return;
  pg.merged = !pg.merged;

  if (pg.merged) {
    for (const tab of pg.tabs) tab.el.classList.add('tab-inactive');
    pg.mergedEl.classList.remove('tab-inactive');
    rebuildMergedView(pg);
  } else {
    pg.mergedEl.classList.add('tab-inactive');
    if (activateTabId != null) pg.activeTabId = activateTabId;
    for (const tab of pg.tabs) {
      tab.el.classList.toggle('tab-inactive', tab.id !== pg.activeTabId);
    }
    focusGroup(pgId);
  }

  renderGroupTabBar(pg);
  notifyStateChanged();
}

function formatDuration(ms) {
  if (ms == null) return null;
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), rem = s % 60;
  if (m < 60) return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60), mrem = m % 60;
  return mrem > 0 ? `${h}h ${mrem}m` : `${h}h`;
}

function buildGapElement(count, fromTs, toTs) {
  const el = document.createElement('div');
  el.className = 'log-gap';
  if (fromTs) el.dataset.fromTs = fromTs;
  const durMs = fromTs && toTs ? new Date(toTs).getTime() - new Date(fromTs).getTime() : null;
  const dur = formatDuration(durMs > 0 ? durMs : null);
  const lines = count === 1 ? '1 line skipped' : `${count} lines skipped`;
  const span = document.createElement('span');
  span.textContent = dur ? `(${dur}, ${lines})` : `(${lines})`;
  el.appendChild(span);
  return el;
}

function insertGapMarkers(logEl, entries, lastVisibleTs) {
  let gapCount = 0, gapFromTs = lastVisibleTs ?? null;
  for (const entry of entries) {
    if (entry.style.display === 'none') {
      gapCount++;
    } else {
      if (gapCount > 0) {
        logEl.insertBefore(buildGapElement(gapCount, gapFromTs, entry.dataset.ts || null), entry);
        gapCount = 0;
      }
      gapFromTs = entry.dataset.ts || gapFromTs;
    }
  }
  if (gapCount > 0) logEl.appendChild(buildGapElement(gapCount, gapFromTs, null));
}

function reapplyTailGaps(logEl, newEntryEls) {
  if (!newEntryEls.length) return;

  // Walk back from just before the new batch to find the last visible entry (anchor).
  let anchorEl = null;
  let el = newEntryEls[0].previousElementSibling;
  while (el) {
    if (el.classList.contains('log-entry') && el.style.display !== 'none') {
      anchorEl = el;
      break;
    }
    el = el.previousElementSibling;
  }

  // Remove all gap markers from the anchor forward.
  el = anchorEl ? anchorEl.nextElementSibling : logEl.firstElementChild;
  while (el) {
    const next = el.nextElementSibling;
    if (el.classList.contains('log-gap')) el.remove();
    el = next;
  }

  // Reinsert gaps from the anchor through end of logEl.
  const startEl = anchorEl ? anchorEl.nextElementSibling : logEl.firstElementChild;
  const tail = [];
  el = startEl;
  while (el) {
    if (el.classList.contains('log-entry')) tail.push(el);
    el = el.nextElementSibling;
  }
  insertGapMarkers(logEl, tail, anchorEl?.dataset?.ts ?? null);
}

function applyPanelFocus(tab) {
  const entries = [...tab.logEl.querySelectorAll('.log-entry')];

  if (!focusState.active) {
    tab.focusMatchCount = 0;
    for (const gap of tab.logEl.querySelectorAll('.log-gap')) gap.remove();
    for (const entry of entries) clearHighlight(entry);
    applyFilters(tab);
    return;
  }

  for (const gap of tab.logEl.querySelectorAll('.log-gap')) gap.remove();

  const matchIdxs = [];
  entries.forEach((entry, i) => {
    const text = entry.querySelector('.log-body')?.textContent ?? entry.textContent;
    if (lineMatchesFocus(text)) matchIdxs.push(i);
  });
  const matchSet = new Set(matchIdxs);

  const visible = new Set();
  const { contextEnabled, contextType, contextAmount, contextDirection } = focusState;

  if (!contextEnabled) {
    for (const idx of matchIdxs) visible.add(idx);
  } else if (contextType === 'line') {
    const before = contextDirection !== 'after'  ? contextAmount : 0;
    const after  = contextDirection !== 'before' ? contextAmount : 0;
    for (const idx of matchIdxs) {
      for (let i = Math.max(0, idx - before); i <= Math.min(entries.length - 1, idx + after); i++)
        visible.add(i);
    }
  } else {
    // Parse timestamps once (O(n)) rather than re-parsing for every match (was O(n×m)).
    const timestamps = entries.map(e => e.dataset.ts ? new Date(e.dataset.ts).getTime() : 0);
    const before = contextDirection !== 'after'  ? contextAmount * 1000 : 0;
    const after  = contextDirection !== 'before' ? contextAmount * 1000 : 0;

    for (const idx of matchIdxs) {
      visible.add(idx);
      const anchor = timestamps[idx];
      if (!anchor) continue;

      // Binary search for the first entry inside the window (O(log n) per match).
      const lo = anchor - before;
      let left = 0, right = idx;
      while (left < right) {
        const mid = (left + right) >> 1;
        if (timestamps[mid] < lo) left = mid + 1; else right = mid;
      }

      const hi = anchor + after;
      let rLeft = idx, rRight = entries.length - 1;
      while (rLeft < rRight) {
        const mid = (rLeft + rRight + 1) >> 1;
        if (timestamps[mid] > hi) rRight = mid - 1; else rLeft = mid;
      }

      for (let i = left; i <= rLeft; i++) visible.add(i);
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

  // Cache match count so countFocusMatches() can avoid re-scanning the DOM.
  tab.focusMatchCount = matchIdxs.length;

  insertGapMarkers(tab.logEl, entries, null);

  updateFilterBtn(tab);
}

function countFocusMatches() {
  if (!focusState.active) return;
  let matchCount = 0, totalCount = 0;
  for (const pg of panelGroups) {
    for (const tab of pg.tabs) {
      matchCount += tab.focusMatchCount;
      totalCount += tab.lineCount;
    }
  }
  updateFocusCount(matchCount, totalCount);
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

function openFilterDialog(tab, initialPattern = '') {
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
  if (initialPattern) patInput.value = initialPattern;
  patInput.focus();
}

export function findTabContaining(el) {
  const entry = el.closest?.('.log-entry');
  if (entry?.dataset.srcTabId) {
    for (const pg of panelGroups) {
      const tab = pg.tabs.find(t => t.id === entry.dataset.srcTabId);
      if (tab) return tab;
    }
  }
  for (const pg of panelGroups) {
    for (const tab of pg.tabs) {
      if (tab.logEl.contains(el)) return tab;
    }
    if (pg.mergedLogEl?.contains(el)) return pg.tabs[0] ?? null;
  }
  return null;
}

export function openFilterDialogWithPattern(tab, pattern) {
  if (activeFilterDialog && activeFilterDialog._tabId === tab.id) {
    const input = activeFilterDialog.querySelector('.filter-pattern-input');
    if (input) { input.value = pattern; input.focus(); }
    return;
  }
  openFilterDialog(tab, pattern);
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

  const evColEl = document.createElement('span');
  evColEl.className = 'log-event-col';
  entry.appendChild(evColEl);

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

function pruneLines(logEl, toRemove) {
  for (let i = 0; i < toRemove; i++) {
    logEl.firstElementChild.remove();
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
  const tabsScroll = tabBar.querySelector('.panel-group-tabs-scroll');
  tabsScroll.innerHTML = '';

  for (const tab of pg.tabs) {
    const tabEl = document.createElement('div');
    // In merged mode no tab shows as active; clicking a tab exits merged mode
    tabEl.className = 'tab' + (tab.id === pg.activeTabId && !pg.merged ? ' active' : '');
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
    tabEl.addEventListener('click', () => {
      if (pg.merged) {
        // Clicking a tab exits merged mode and activates that tab
        toggleMergedView(pg.id, tab.id);
      } else {
        activateTab(pg.id, tab.id);
      }
    });

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

    tabsScroll.appendChild(tabEl);
  }

  // Update merge button state
  const mergeBtn = tabBar.querySelector('.btn-merge');
  if (mergeBtn) {
    mergeBtn.classList.toggle('active', pg.merged);
    mergeBtn.title = pg.merged ? 'Exit merged view' : 'Merge all logs';
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

  // Scrollable tab strip
  const tabsScroll = document.createElement('div');
  tabsScroll.className = 'panel-group-tabs-scroll';

  // Drop zone on empty tab bar space (append to this group)
  tabsScroll.addEventListener('dragover', e => {
    if (!dragSrc) return;
    if (e.target.closest('.tab')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    tabBar.classList.add('drag-over');
  });
  tabsScroll.addEventListener('dragleave', e => {
    if (!tabsScroll.contains(e.relatedTarget)) tabBar.classList.remove('drag-over');
  });
  tabsScroll.addEventListener('drop', e => {
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

  // Merge toggle button — fixed on right of tab bar, always visible
  const mergeBtn = document.createElement('button');
  mergeBtn.className = 'btn-merge';
  mergeBtn.textContent = '⊕';
  mergeBtn.title = 'Merge all logs';
  mergeBtn.addEventListener('click', e => {
    e.stopPropagation();
    toggleMergedView(pgId);
  });

  tabBar.appendChild(tabsScroll);
  tabBar.appendChild(mergeBtn);
  el.appendChild(tabBar);

  // Merged view panel (hidden until merged mode is toggled on)
  const mergedPanelEl = document.createElement('div');
  mergedPanelEl.className = 'panel tab-inactive';

  const mergedToolbar = document.createElement('div');
  mergedToolbar.className = 'panel-toolbar';
  const mergedLabel = document.createElement('span');
  mergedLabel.className = 'panel-label';
  mergedLabel.textContent = 'Merged Logs';
  mergedToolbar.appendChild(mergedLabel);

  const mergedLogEl = document.createElement('div');
  mergedLogEl.className = 'panel-log';

  const mergedWrap = document.createElement('div');
  mergedWrap.className = 'panel-log-wrap';
  mergedWrap.appendChild(mergedLogEl);

  const mergedFooter = document.createElement('div');
  mergedFooter.className = 'panel-footer';
  mergedFooter.textContent = '0 lines (merged)';

  mergedPanelEl.appendChild(mergedToolbar);
  mergedPanelEl.appendChild(mergedWrap);
  mergedPanelEl.appendChild(mergedFooter);
  el.appendChild(mergedPanelEl);

  // Clicking anywhere in this panel group focuses it
  el.addEventListener('mousedown', () => focusGroup(pgId));

  const pg = { id: pgId, el, activeTabId: null, tabs: [], merged: false, mergedEl: mergedPanelEl, mergedLogEl, mergedEntries: [] };
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
    // In merged mode all tab panels stay hidden
    tab.el.classList.toggle('tab-inactive', pg.merged || tab.id !== tabId);
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
      for (const t of pg.tabs) t.el.classList.toggle('tab-inactive', pg.merged || t.id !== pg.activeTabId);
    }
    renderGroupTabBar(pg);
    if (pg.merged) {
      // Remove only the closed tab's entries; no need for a full rebuild.
      const removedId = tabId;
      pg.mergedEntries = pg.mergedEntries.filter(e => {
        if (e.tabId === removedId) { e.el.remove(); return false; }
        return true;
      });
      pg.mergedEl.querySelector('.panel-footer').textContent =
        `${pg.mergedEntries.length.toLocaleString()} lines (merged)`;
    }
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
      for (const t of srcPg.tabs) t.el.classList.toggle('tab-inactive', srcPg.merged || t.id !== srcPg.activeTabId);
    }
    renderGroupTabBar(srcPg);
    if (srcPg.merged) rebuildMergedView(srcPg);
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
  if (dstPg.merged) rebuildMergedView(dstPg);
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
    lineCount: 0, lastTs: null, lastTsMs: 0, filters: [], hasLevel: false,
    focusMatchCount: 0, activeRanges: [],
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
  // If the group is already in merged mode, include the new tab's panel
  // (history not loaded yet, but live lines will flow via appendToMergedView;
  //  prependLines will call rebuildMergedView once history arrives)
  if (pg.merged) tab.el.classList.add('tab-inactive');
  return tabId;
}

export function closePanel(id) {
  for (const pg of panelGroups) {
    const tab = pg.tabs.find(t => t.id === id);
    if (tab) { removeTab(pg.id, id); return; }
  }
}

// ── Log line ingestion ────────────────────────────────────────────────────────

// Accepts a batch of {group, ns, pod, container, ts, message, fields, level}
// objects. Groups by tab so each tab gets one DocumentFragment append, one
// scroll-position read, one footer update, and one prune check per call.
export function appendLines(messages) {
  const highlightRe = focusState.active ? buildFocusHighlightRe() : null;

  // Build per-tab batches in a single pass over the message list.
  const tabBatches = new Map();
  for (const msg of messages) {
    const result = getTabByKey(msg.group, msg.ns, msg.pod, msg.container);
    if (!result) continue;
    const { tab, pg } = result;
    if (!tabBatches.has(tab.id)) tabBatches.set(tab.id, { tab, pg, entries: [] });

    const ts = msg.ts || '';
    const level = msg.level || '';
    const entry = buildLogEntry(ts, msg.message || '', msg.fields || null, level);

    if (!tab.hasLevel && level && level !== 'OTHER') {
      tab.hasLevel = true;
      tab.el.classList.add('has-level');
    }

    const bodyEl = entry.querySelector('.log-body');
    const text = bodyEl ? bodyEl.textContent : msg.message || '';
    const panelVisible = lineVisible(tab.filters, text);
    const matches = focusState.active && lineMatchesFocus(text);
    const focusVisible = !focusState.active || matches;
    if (!panelVisible || !focusVisible) {
      entry.style.display = 'none';
    } else if (matches) {
      applyHighlight(entry, highlightRe);
    }
    if (matches) tab.focusMatchCount++;

    tabBatches.get(tab.id).entries.push({ entry, ts, rawText: msg.text || msg.message || '' });
  }

  for (const { tab, pg, entries } of tabBatches.values()) {
    const { logEl } = tab;
    const isActive = pg.activeTabId === tab.id && !pg.merged;
    // Read scroll position once before appending to avoid per-line reflows.
    const atBottom = isActive
      ? logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40
      : true;

    const frag = document.createDocumentFragment();
    for (const { entry, ts, rawText } of entries) {
      entry.dataset.rawText = rawText.slice(0, 2000);

      // Apply active-duration highlight from prior trigger events
      const tsMs = ts ? new Date(ts).getTime() : 0;
      if (tsMs && tab.activeRanges.length) {
        tab.activeRanges = tab.activeRanges.filter(r => r.endTs === Infinity || r.endTs >= tsMs);
        if (tab.activeRanges.length) {
          entry.classList.add('log-entry--active');
          entry.style.setProperty('--event-active-color', tab.activeRanges[0].color);
        }
      }

      // Match event templates and start new active ranges
      const evs = matchAndAnnotate(entry, rawText);
      if (evs && tsMs) {
        for (const ev of evs) {
          if (ev.activeDuration === 0) continue;
          const endTs = ev.activeDuration === -1 ? Infinity : tsMs + ev.activeDuration;
          tab.activeRanges.push({ endTs, color: ev.color || '#4ec9b0' });
          entry.classList.add('log-entry--active');
          entry.style.setProperty('--event-active-color', ev.color || '#4ec9b0');
        }
      }

      frag.appendChild(entry);
      tab.lineCount++;
      if (ts) { tab.lastTs = ts; tab.lastTsMs = new Date(ts).getTime(); }
    }
    logEl.appendChild(frag); // single DOM mutation for the whole batch

    if (focusState.active) reapplyTailGaps(logEl, entries.map(e => e.entry));

    updateFooter(tab);

    if (tab.lineCount > MAX_LINES) {
      pruneLines(logEl, tab.lineCount - PRUNE_TO);
      tab.lineCount = PRUNE_TO;
    }

    if (isActive && atBottom) logEl.scrollTop = logEl.scrollHeight;

    if (pg.merged) {
      for (const { entry, ts } of entries) appendToMergedView(pg, tab, ts, entry);
    }
  }
}

export function prependLines(group, ns, pod, container, lines) {
  const result = getTabByKey(group, ns, pod, container);
  if (!result || !lines.length) return;
  const { tab, pg } = result;
  const { logEl } = tab;

  // Keep element references so we can pass them to mergeIntoMergedView below.
  const builtEntries = [];
  const frag = document.createDocumentFragment();
  for (const line of lines) {
    const entry = buildLogEntry(line.ts || '', line.message || '', line.fields || null, line.level || '');
    const rawText = line.message || '';
    entry.dataset.rawText = rawText.slice(0, 2000);
    matchAndAnnotate(entry, rawText);
    frag.appendChild(entry);
    builtEntries.push(entry);
  }

  if (!tab.hasLevel && lines.some(l => l.level && l.level !== 'OTHER')) {
    tab.hasLevel = true;
    tab.el.classList.add('has-level');
  }

  logEl.insertBefore(frag, logEl.firstChild);
  tab.lineCount += lines.length;
  let prunedCount = 0;
  if (tab.lineCount > MAX_LINES) {
    prunedCount = tab.lineCount - PRUNE_TO;
    pruneLines(logEl, prunedCount);
    tab.lineCount = PRUNE_TO;
  }

  applyActiveDurations(logEl);
  rebuildActiveRanges(tab);

  if (!tab.lastTs) {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].ts) {
        tab.lastTs = lines[i].ts;
        tab.lastTsMs = new Date(lines[i].ts).getTime();
        break;
      }
    }
  }
  updateFooter(tab);
  applyPanelFocus(tab);
  if (pg.merged) {
    if (prunedCount > 0) {
      // Pruning removed some prepended entries from logEl; fall back to full
      // rebuild rather than trying to reconcile which clones to discard.
      rebuildMergedView(pg);
    } else {
      mergeIntoMergedView(pg, tab, builtEntries);
    }
  }
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
      merged: pg.merged,
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

// Returns all matched events across all open tabs, with tab + entry references.
// [{ ts, tsMs, name, icon, color, metadata, tab, entry }]
export function getAllEvents() {
  const results = [];
  for (const pg of panelGroups) {
    for (const tab of pg.tabs) {
      for (const entry of tab.logEl.children) {
        if (!entry.dataset.eventData) continue;
        const ts = entry.dataset.ts;
        if (!ts) continue;
        const tsMs = new Date(ts).getTime();
        if (!tsMs) continue;
        let evs;
        try { evs = JSON.parse(entry.dataset.eventData); } catch { continue; }
        for (const ev of evs) {
          results.push({ ts, tsMs, name: ev.name, icon: ev.icon, color: ev.color, metadata: ev.metadata, tab, entry });
        }
      }
    }
  }
  return results;
}

// Recompute all event annotations when templates or enabled state changes.
document.addEventListener('events:changed', () => {
  for (const pg of panelGroups) {
    for (const tab of pg.tabs) {
      for (const entry of tab.logEl.querySelectorAll('.log-entry')) {
        clearEntryEvents(entry);
        const text = entry.dataset.rawText || entry.querySelector('.log-body')?.textContent || '';
        matchAndAnnotate(entry, text);
      }
      tab.activeRanges = [];
      applyActiveDurations(tab.logEl);
      rebuildActiveRanges(tab);
    }
  }
});
