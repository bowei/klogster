// Global focus state — applied across all panels simultaneously.
export const focusState = {
  active: false,
  pattern: '',
  re: null,              // compiled RegExp, null if empty/invalid
  contextType: 'line',   // 'line' | 'time'
  contextAmount: 3,      // lines, or seconds
  contextDirection: 'around', // 'before' | 'around' | 'after'
};

let activeFocusDialog = null;
let focusBtn = null;

function notifyChanged() {
  document.dispatchEvent(new CustomEvent('focus:changed'));
}

function updateFocusBtn() {
  if (!focusBtn) return;
  if (focusState.active) {
    focusBtn.textContent = 'focus ●';
    focusBtn.classList.add('active');
  } else {
    focusBtn.textContent = 'Focus';
    focusBtn.classList.remove('active');
  }
}

export function openFocusDialog(btn) {
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

  // Pattern row
  const patRow = document.createElement('div');
  patRow.className = 'focus-pat-row';

  const patInput = document.createElement('input');
  patInput.type = 'text';
  patInput.className = 'focus-pattern-input';
  patInput.placeholder = 'regexp to match…';
  patInput.spellcheck = false;
  patInput.value = focusState.pattern;

  const errEl = document.createElement('span');
  errEl.className = 'focus-pat-err';

  patRow.appendChild(patInput);
  patRow.appendChild(errEl);

  // Context row
  const ctxRow = document.createElement('div');
  ctxRow.className = 'focus-context-row';

  const ctxLabel = document.createElement('span');
  ctxLabel.className = 'focus-ctx-label';
  ctxLabel.textContent = 'Context';

  const typeSelect = document.createElement('select');
  typeSelect.className = 'focus-select';
  [['line', 'Lines'], ['time', 'Seconds']].forEach(([v, t]) => {
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
  amountInput.max = focusState.contextType === 'line' ? '200' : '3600';
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

  ctxRow.appendChild(ctxLabel);
  ctxRow.appendChild(typeSelect);
  ctxRow.appendChild(amountInput);
  ctxRow.appendChild(dirSelect);

  // Status line
  const statusEl = document.createElement('div');
  statusEl.className = 'focus-status';

  dialog.appendChild(header);
  dialog.appendChild(patRow);
  dialog.appendChild(ctxRow);
  dialog.appendChild(statusEl);

  document.body.appendChild(dialog);
  positionDialog(btn, dialog);

  // ── Event handlers ──────────────────────────────────────────────

  function applyPattern() {
    const raw = patInput.value.trim();
    errEl.textContent = '';
    if (!raw) {
      focusState.active = false;
      focusState.pattern = '';
      focusState.re = null;
      updateFocusBtn();
      notifyChanged();
      updateStatus();
      return;
    }
    let re = null;
    try {
      re = new RegExp(raw, 'i');
    } catch (e) {
      errEl.textContent = 'Invalid regexp';
      return;
    }
    focusState.active = true;
    focusState.pattern = raw;
    focusState.re = re;
    updateFocusBtn();
    notifyChanged();
    updateStatus();
  }

  function applyContext() {
    focusState.contextType = typeSelect.value;
    amountInput.max = focusState.contextType === 'line' ? '200' : '3600';
    focusState.contextAmount = Math.max(0, parseInt(amountInput.value, 10) || 0);
    focusState.contextDirection = dirSelect.value;
    if (focusState.active) notifyChanged();
    updateStatus();
  }

  function updateStatus() {
    if (!focusState.active || !focusState.re) {
      statusEl.textContent = 'No active focus';
      return;
    }
    document.dispatchEvent(new CustomEvent('focus:count-request', { detail: { statusEl } }));
  }

  patInput.addEventListener('input', applyPattern);
  patInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') { dialog.remove(); activeFocusDialog = null; }
  });

  typeSelect.addEventListener('change', applyContext);
  amountInput.addEventListener('input', applyContext);
  dirSelect.addEventListener('change', applyContext);

  // Click outside to close
  function onOutside(e) {
    if (!dialog.contains(e.target) && e.target !== btn) {
      dialog.remove();
      activeFocusDialog = null;
      document.removeEventListener('mousedown', onOutside, true);
    }
  }
  setTimeout(() => document.addEventListener('mousedown', onOutside, true), 0);

  patInput.focus();
  patInput.select();
  updateStatus();
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
  if (!saved || !saved.pattern) return;
  focusBtn = document.getElementById('btn-focus');
  focusState.pattern = saved.pattern;
  focusState.contextType = saved.contextType || 'line';
  focusState.contextAmount = saved.contextAmount ?? 3;
  focusState.contextDirection = saved.contextDirection || 'around';
  focusState.active = Boolean(saved.active);
  if (focusState.active && focusState.pattern) {
    try { focusState.re = new RegExp(focusState.pattern, 'i'); } catch {}
  }
  updateFocusBtn();
}
