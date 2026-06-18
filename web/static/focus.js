// Global focus state — applied across all panels simultaneously.
export const focusState = {
  active: false,
  patterns: [],   // [{pattern: string, re: RegExp|null}]
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
  const n = focusState.patterns.length;
  if (focusState.active && n > 0) {
    focusBtn.textContent = `focus (${n})`;
    focusBtn.classList.add('active');
  } else {
    focusBtn.textContent = 'Focus';
    focusBtn.classList.remove('active');
  }
}

export function lineMatchesFocus(text) {
  return focusState.patterns.some(p => p.re && p.re.test(text));
}

export function buildFocusHighlightRe() {
  const valid = focusState.patterns.filter(p => p.re);
  if (!valid.length) return null;
  return new RegExp(valid.map(p => `(?:${p.pattern})`).join('|'), 'gi');
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

  // Pattern list
  const listEl = document.createElement('div');
  listEl.className = 'focus-list';

  function renderList() {
    listEl.innerHTML = '';
    if (focusState.patterns.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'focus-empty';
      empty.textContent = 'No patterns yet';
      listEl.appendChild(empty);
      return;
    }
    focusState.patterns.forEach((fp, i) => {
      const item = document.createElement('div');
      item.className = 'focus-item';

      const pat = document.createElement('span');
      pat.className = 'focus-item-pattern' + (fp.re ? '' : ' focus-item-pattern-invalid');
      pat.textContent = fp.pattern;
      pat.title = fp.re ? fp.pattern : `Invalid regexp: ${fp.pattern}`;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'focus-remove';
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => {
        focusState.patterns.splice(i, 1);
        focusState.active = focusState.patterns.length > 0;
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

  // Add row
  const addRow = document.createElement('div');
  addRow.className = 'focus-add-row';

  const addInputs = document.createElement('div');
  addInputs.className = 'focus-add-inputs';

  const patInput = document.createElement('input');
  patInput.type = 'text';
  patInput.className = 'focus-pattern-input';
  patInput.placeholder = 'regexp to match…';
  patInput.spellcheck = false;

  const addBtn = document.createElement('button');
  addBtn.className = 'focus-add-btn';
  addBtn.textContent = 'Add';

  const errEl = document.createElement('span');
  errEl.className = 'focus-pat-err';

  addInputs.appendChild(patInput);
  addInputs.appendChild(addBtn);
  addRow.appendChild(addInputs);
  addRow.appendChild(errEl);

  function doAdd() {
    const raw = patInput.value.trim();
    errEl.textContent = '';
    if (!raw) return;
    let re = null;
    try {
      re = new RegExp(raw, 'i');
    } catch {
      errEl.textContent = 'Invalid regexp';
      return;
    }
    if (focusState.patterns.some(p => p.pattern === raw)) {
      patInput.value = '';
      patInput.focus();
      return;
    }
    focusState.patterns.push({ pattern: raw, re });
    focusState.active = true;
    updateFocusBtn();
    notifyChanged();
    renderList();
    updateStatus();
    patInput.value = '';
    patInput.focus();
  }

  addBtn.addEventListener('click', doAdd);
  patInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') doAdd();
    if (e.key === 'Escape') { dialog.remove(); activeFocusDialog = null; }
  });

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
  dialog.appendChild(listEl);
  dialog.appendChild(addRow);
  dialog.appendChild(ctxRow);
  dialog.appendChild(statusEl);

  document.body.appendChild(dialog);
  positionDialog(btn, dialog);

  function applyContext() {
    focusState.contextType = typeSelect.value;
    amountInput.max = focusState.contextType === 'line' ? '200' : '3600';
    focusState.contextAmount = Math.max(0, parseInt(amountInput.value, 10) || 0);
    focusState.contextDirection = dirSelect.value;
    if (focusState.active) notifyChanged();
    updateStatus();
  }

  function updateStatus() {
    if (!focusState.active || focusState.patterns.length === 0) {
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
  patInput.focus();
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
  if (!saved) return;
  focusBtn = document.getElementById('btn-focus');
  focusState.contextType = saved.contextType || 'line';
  focusState.contextAmount = saved.contextAmount ?? 3;
  focusState.contextDirection = saved.contextDirection || 'around';

  // Support old format (saved.pattern string) and new format (saved.patterns array)
  const patternStrings = Array.isArray(saved.patterns)
    ? saved.patterns
    : (saved.pattern ? [saved.pattern] : []);

  focusState.patterns = patternStrings.map(pat => {
    let re = null;
    try { re = new RegExp(pat, 'i'); } catch {}
    return { pattern: pat, re };
  });
  focusState.active = Boolean(saved.active) && focusState.patterns.length > 0;
  updateFocusBtn();
}
