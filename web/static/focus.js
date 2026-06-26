// Global focus state — applied across all panels simultaneously.
import { ruleMatches, ruleIsEmpty, ruleSummary, buildFilterCompose } from './filter.js';

export const focusState = {
  active: false,
  filters: [],  // array of filter rules (always positive — no type field needed)
  contextEnabled: false,
  contextType: 'line',
  contextAmount: 3,
  contextDirection: 'around',
};

let activeFocusDialog = null;
let focusBtn = null;

function notifyChanged() {
  document.dispatchEvent(new CustomEvent('focus:changed'));
}

function updateFocusBtn() {
  if (!focusBtn) return;
  const n = focusState.filters.length;
  if (focusState.active && n > 0) {
    focusBtn.textContent = `focus (${n})`;
    focusBtn.classList.add('active');
  } else {
    focusBtn.textContent = 'Focus';
    focusBtn.classList.remove('active');
  }
}

// Returns true if the entry matches any active focus filter.
export function entryMatchesFocus(entry) {
  return focusState.filters.some(f => ruleMatches(f, entry));
}

// Build a combined highlight regex from query.text of all filters.
// Used to highlight matching text in focused lines.
export function buildFocusHighlightRe() {
  const parts = [];
  for (const f of focusState.filters) {
    if (!f.query || !f.query.text) continue;
    if (f.query.regex) {
      try { new RegExp(f.query.text); parts.push(`(?:${f.query.text})`); } catch {}
    } else {
      parts.push(`(?:${f.query.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`);
    }
  }
  if (!parts.length) return null;
  return new RegExp(parts.join('|'), 'gi');
}

export function openFocusDialog(btn, initialPattern = '') {
  focusBtn = btn;

  if (activeFocusDialog) {
    activeFocusDialog.remove();
    activeFocusDialog = null;
    return;
  }

  const dialog = document.createElement('div');
  dialog.className = 'focus-dialog';
  activeFocusDialog = dialog;

  // Header
  const header = document.createElement('div');
  header.className = 'focus-dialog-header';
  header.textContent = 'Focus';

  // Filter rule list
  const listEl = document.createElement('div');
  listEl.className = 'focus-list';

  function renderList() {
    listEl.innerHTML = '';
    if (focusState.filters.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'focus-empty';
      empty.textContent = 'No patterns yet';
      listEl.appendChild(empty);
      return;
    }
    focusState.filters.forEach((f, i) => {
      const item = document.createElement('div');
      item.className = 'focus-item';

      const pat = document.createElement('span');
      pat.className = 'focus-item-pattern';
      pat.textContent = ruleSummary(f);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'focus-remove';
      removeBtn.textContent = '\xd7';
      removeBtn.addEventListener('click', () => {
        focusState.filters.splice(i, 1);
        focusState.active = focusState.filters.length > 0;
        updateFocusBtn();
        notifyChanged();
        renderList();
        updateStatus();
      });

      item.appendChild(pat);
      item.appendChild(removeBtn);
      listEl.appendChild(item);
    });
  }

  // Compose form (positive-only — no type selector)
  const compose = buildFilterCompose({
    showType: false,
    onAdd(rule) {
      if (focusState.filters.some(f => ruleSummary(f) === ruleSummary(rule))) return;
      focusState.filters.push(rule);
      focusState.active = true;
      updateFocusBtn();
      notifyChanged();
      renderList();
      updateStatus();
    },
    addLabel: 'Add',
  });
  compose.el.addEventListener('filter:escape', () => { dialog.remove(); activeFocusDialog = null; });

  // Context row
  const ctxRow = document.createElement('div');
  ctxRow.className = 'focus-context-row';

  const ctxCheckbox = document.createElement('input');
  ctxCheckbox.type = 'checkbox';
  ctxCheckbox.className = 'focus-ctx-checkbox';
  ctxCheckbox.id = 'focus-ctx-enabled';
  ctxCheckbox.checked = focusState.contextEnabled;

  const ctxLabel = document.createElement('label');
  ctxLabel.className = 'focus-ctx-label';
  ctxLabel.htmlFor = 'focus-ctx-enabled';
  ctxLabel.textContent = 'Context';

  const typeSelect = document.createElement('select');
  typeSelect.className = 'focus-select';
  [['line', 'Lines'], ['time', 'Milliseconds']].forEach(([v, t]) => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = t;
    typeSelect.appendChild(opt);
  });
  typeSelect.value = focusState.contextType;

  const amountInput = document.createElement('input');
  amountInput.type = 'number';
  amountInput.className = 'focus-amount-input';
  amountInput.min = '0';
  amountInput.max = focusState.contextType === 'line' ? '200' : '3600000';
  amountInput.value = focusState.contextAmount;

  const dirSelect = document.createElement('select');
  dirSelect.className = 'focus-select';
  [['around', 'Around'], ['before', 'Before'], ['after', 'After']].forEach(([v, t]) => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = t;
    dirSelect.appendChild(opt);
  });
  dirSelect.value = focusState.contextDirection;

  function updateCtxControls() {
    const on = ctxCheckbox.checked;
    typeSelect.disabled = !on;
    amountInput.disabled = !on;
    dirSelect.disabled = !on;
  }
  updateCtxControls();

  ctxCheckbox.addEventListener('change', () => {
    focusState.contextEnabled = ctxCheckbox.checked;
    updateCtxControls();
    if (focusState.active) notifyChanged();
    updateStatus();
  });

  ctxRow.appendChild(ctxCheckbox);
  ctxRow.appendChild(ctxLabel);
  ctxRow.appendChild(typeSelect);
  ctxRow.appendChild(amountInput);
  ctxRow.appendChild(dirSelect);

  // Status line
  const statusEl = document.createElement('div');
  statusEl.className = 'focus-status';

  dialog.appendChild(header);
  dialog.appendChild(listEl);
  dialog.appendChild(compose.el);
  dialog.appendChild(ctxRow);
  dialog.appendChild(statusEl);

  document.body.appendChild(dialog);
  positionDialog(btn, dialog);

  function applyContext() {
    focusState.contextType = typeSelect.value;
    amountInput.max = focusState.contextType === 'line' ? '200' : '3600000';
    focusState.contextAmount = Math.max(0, parseInt(amountInput.value, 10) || 0);
    focusState.contextDirection = dirSelect.value;
    if (focusState.active) notifyChanged();
    updateStatus();
  }

  function updateStatus() {
    if (!focusState.active || focusState.filters.length === 0) {
      statusEl.textContent = 'No active focus';
      return;
    }
    document.dispatchEvent(new CustomEvent('focus:count-request', { detail: { statusEl } }));
  }

  typeSelect.addEventListener('change', applyContext);
  amountInput.addEventListener('input', applyContext);
  dirSelect.addEventListener('change', applyContext);

  function onOutside(e) {
    if (!dialog.contains(e.target) && e.target !== btn) {
      dialog.remove();
      activeFocusDialog = null;
      document.removeEventListener('mousedown', onOutside, true);
    }
  }
  setTimeout(() => document.addEventListener('mousedown', onOutside, true), 0);

  renderList();
  if (initialPattern) compose.setQuery(initialPattern); else compose.focus();
  updateStatus();
}

export function openFocusDialogWithPattern(pattern) {
  if (activeFocusDialog) {
    const input = activeFocusDialog.querySelector('.filter-pattern-input');
    if (input) { input.value = pattern; input.focus(); }
    return;
  }
  const btn = document.getElementById('btn-focus');
  openFocusDialog(btn, pattern);
}

function positionDialog(anchor, dialog) {
  const rect = anchor.getBoundingClientRect();
  dialog.style.top = `${rect.bottom + 4}px`;
  dialog.style.left = `${rect.left}px`;
}

export function updateFocusCount(matchCount, totalCount) {
  if (!activeFocusDialog) return;
  const statusEl = activeFocusDialog.querySelector('.focus-status');
  if (statusEl) {
    statusEl.textContent = `${matchCount.toLocaleString()} of ${totalCount.toLocaleString()} lines match`;
  }
}

export function restoreFocusState(saved) {
  if (!saved) return;
  focusBtn = document.getElementById('btn-focus');
  focusState.contextEnabled = Boolean(saved.contextEnabled);
  focusState.contextType = saved.contextType || 'line';
  focusState.contextAmount = saved.contextAmount ?? 3;
  focusState.contextDirection = saved.contextDirection || 'around';

  if (Array.isArray(saved.filters)) {
    // New format
    focusState.filters = saved.filters.filter(f => f && !ruleIsEmpty(f));
  } else {
    // Migrate old format: patterns: [string, ...]
    const patternStrings = Array.isArray(saved.patterns)
      ? saved.patterns
      : (saved.pattern ? [saved.pattern] : []);
    focusState.filters = patternStrings
      .filter(Boolean)
      .map(pat => ({ type: 'positive', query: { text: pat, caseSensitive: false, regex: true }, levels: [], metadata: [] }));
  }
  focusState.active = Boolean(saved.active) && focusState.filters.length > 0;
  updateFocusBtn();
}
