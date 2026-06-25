// filter.js — Shared filter logic and reusable compose-form builder.
// Used by per-tab filters, focus, and event template matching.

export const FILTER_LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL', 'TRACE'];

export function textMatches(text, query) {
  if (!query.text) return true;
  if (query.regex) {
    try {
      const re = new RegExp(query.text, query.caseSensitive ? '' : 'i');
      return re.test(text);
    } catch { return false; }
  }
  return query.caseSensitive
    ? text.includes(query.text)
    : text.toLowerCase().includes(query.text.toLowerCase());
}

export function ruleMatches(rule, entry) {
  const rawText = entry.dataset.rawText || entry.querySelector?.('.log-body')?.textContent || '';
  if (rule.query && rule.query.text && !textMatches(rawText, rule.query)) return false;
  if (rule.levels && rule.levels.length > 0) {
    if (!rule.levels.includes(entry.dataset.level || 'OTHER')) return false;
  }
  if (rule.metadata && rule.metadata.length > 0) {
    let fields = {};
    if (entry.dataset.fields) {
      try { fields = JSON.parse(entry.dataset.fields); } catch {}
    }
    for (const m of rule.metadata) {
      if (!m.key && !m.value) continue;
      if (m.key) {
        if (!(m.key in fields)) return false;
        if (m.value && !textMatches(String(fields[m.key]), { text: m.value, caseSensitive: m.caseSensitive, regex: m.regex })) return false;
      } else {
        if (!Object.values(fields).some(v => textMatches(String(v), { text: m.value, caseSensitive: m.caseSensitive, regex: m.regex }))) return false;
      }
    }
  }
  return true;
}

export function ruleIsEmpty(rule) {
  return (!rule.query || !rule.query.text) &&
    (!rule.levels || rule.levels.length === 0) &&
    (!rule.metadata || rule.metadata.every(m => !m.key && !m.value));
}

export function ruleSummary(rule) {
  const parts = [];
  if (rule.query && rule.query.text) {
    const flags = [rule.query.caseSensitive ? 'Aa' : '', rule.query.regex ? '.*' : ''].filter(Boolean).join(' ');
    parts.push(`"${rule.query.text}"${flags ? ` (${flags})` : ''}`);
  }
  if (rule.levels && rule.levels.length > 0) parts.push(`level: ${rule.levels.join(',')}`);
  if (rule.metadata) {
    for (const m of rule.metadata) {
      if (m.key || m.value) parts.push(`${m.key || '*'}=${m.value || '*'}`);
    }
  }
  return parts.join(' \xb7 ') || '(empty)';
}

// Build a reusable filter compose form.
//
// Options:
//   showType    — show the + show / − hide type selector (default true; set false for focus/events)
//   onAdd       — if provided, called with (rule) on submit; also shows a submit button
//   addLabel    — label for the submit button (default 'Add filter')
//   initialRule — pre-populate the form from an existing rule object
//
// Returns { el, setQuery(text), getRule(), reset() }
//   el        — the root DOM element to attach
//   setQuery  — populate the query input and focus it
//   getRule   — read the current form state as a rule object
//   reset     — clear the form back to defaults
//
// Dispatches a 'filter:escape' CustomEvent (bubbles) on the form when the user
// presses Escape inside the query input, so the enclosing dialog can close itself.
export function buildFilterCompose({ showType = true, onAdd = null, addLabel = 'Add filter', initialRule = null } = {}) {
  const init = initialRule || {};
  const initQuery = init.query || { text: '', caseSensitive: false, regex: false };
  const initLevels = init.levels ? [...init.levels] : [];
  const initMeta = init.metadata ? [...init.metadata] : [];

  const form = document.createElement('div');
  form.className = 'filter-compose';

  // ── Type selector (optional) ──────────────────────────────────────────────
  let typeSelect = null;
  if (showType) {
    const typeRow = document.createElement('div');
    typeRow.className = 'filter-type-row';
    typeSelect = document.createElement('select');
    typeSelect.className = 'filter-type-select';
    [['positive', '+ show only matching'], ['negative', '− hide matching']].forEach(([v, t]) => {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = t;
      typeSelect.appendChild(opt);
    });
    typeSelect.value = init.type || 'positive';
    typeRow.appendChild(typeSelect);
    form.appendChild(typeRow);
  }

  // ── Query row ─────────────────────────────────────────────────────────────
  const queryRow = document.createElement('div');
  queryRow.className = 'filter-query-row';
  const queryLabel = document.createElement('span');
  queryLabel.className = 'filter-row-label';
  queryLabel.textContent = 'Query';
  const queryInput = document.createElement('input');
  queryInput.type = 'text';
  queryInput.className = 'filter-pattern-input';
  queryInput.spellcheck = false;
  queryInput.value = initQuery.text || '';

  const btnCase = document.createElement('button');
  btnCase.className = 'filter-toggle-btn';
  btnCase.title = 'Case sensitive';
  btnCase.textContent = 'Aa';
  btnCase.classList.toggle('active', !!initQuery.caseSensitive);
  btnCase.addEventListener('click', () => btnCase.classList.toggle('active'));

  const btnRegex = document.createElement('button');
  btnRegex.className = 'filter-toggle-btn';
  btnRegex.title = 'Regular expression';
  btnRegex.textContent = '.*';
  btnRegex.classList.toggle('active', !!initQuery.regex);
  btnRegex.addEventListener('click', () => {
    btnRegex.classList.toggle('active');
    queryInput.placeholder = btnRegex.classList.contains('active') ? 'regexp…' : 'substring…';
  });
  queryInput.placeholder = initQuery.regex ? 'regexp…' : 'substring…';

  queryRow.appendChild(queryLabel);
  queryRow.appendChild(queryInput);
  queryRow.appendChild(btnCase);
  queryRow.appendChild(btnRegex);
  form.appendChild(queryRow);

  // ── Level chips ───────────────────────────────────────────────────────────
  const levelRow = document.createElement('div');
  levelRow.className = 'filter-level-row';
  const levelLabel = document.createElement('span');
  levelLabel.className = 'filter-row-label';
  levelLabel.textContent = 'Level';
  levelRow.appendChild(levelLabel);
  const levelChips = document.createElement('div');
  levelChips.className = 'filter-level-chips';
  FILTER_LEVELS.forEach(lvl => {
    const chip = document.createElement('button');
    chip.className = 'filter-level-chip';
    chip.textContent = lvl;
    chip.dataset.level = lvl;
    chip.classList.toggle('active', initLevels.includes(lvl));
    chip.addEventListener('click', () => chip.classList.toggle('active'));
    levelChips.appendChild(chip);
  });
  levelRow.appendChild(levelChips);
  form.appendChild(levelRow);

  // ── Metadata rows ─────────────────────────────────────────────────────────
  const metaSection = document.createElement('div');
  metaSection.className = 'filter-meta-section';
  const metaLabel = document.createElement('span');
  metaLabel.className = 'filter-row-label';
  metaLabel.textContent = 'Fields';
  metaSection.appendChild(metaLabel);
  const metaList = document.createElement('div');
  metaList.className = 'filter-meta-list';

  function addMetaRow(key = '', value = '', caseSensitive = false, regex = false) {
    const row = document.createElement('div');
    row.className = 'filter-meta-row';

    const ki = document.createElement('input');
    ki.type = 'text'; ki.className = 'filter-meta-input'; ki.placeholder = 'key';
    ki.spellcheck = false; ki.value = key;

    const vi = document.createElement('input');
    vi.type = 'text'; vi.className = 'filter-meta-input'; vi.placeholder = 'value';
    vi.spellcheck = false; vi.value = value;

    const bc = document.createElement('button');
    bc.className = 'filter-toggle-btn'; bc.title = 'Case sensitive'; bc.textContent = 'Aa';
    bc.classList.toggle('active', caseSensitive);
    bc.addEventListener('click', () => bc.classList.toggle('active'));

    const br = document.createElement('button');
    br.className = 'filter-toggle-btn'; br.title = 'Regular expression'; br.textContent = '.*';
    br.classList.toggle('active', regex);
    br.addEventListener('click', () => br.classList.toggle('active'));

    const del = document.createElement('button');
    del.className = 'filter-remove'; del.textContent = '\xd7';
    del.addEventListener('click', () => row.remove());

    row.appendChild(ki); row.appendChild(vi);
    row.appendChild(bc); row.appendChild(br); row.appendChild(del);
    metaList.appendChild(row);
    return ki;
  }

  // Pre-populate from initialRule
  for (const m of initMeta) addMetaRow(m.key, m.value, m.caseSensitive, m.regex);

  const addMetaBtn = document.createElement('button');
  addMetaBtn.className = 'filter-add-meta-btn';
  addMetaBtn.textContent = '+ add field';
  addMetaBtn.addEventListener('click', () => addMetaRow().focus());
  metaSection.appendChild(metaList);
  metaSection.appendChild(addMetaBtn);
  form.appendChild(metaSection);

  // ── Read current form state ───────────────────────────────────────────────
  function getCurrentRule() {
    const levels = [...levelChips.querySelectorAll('.filter-level-chip.active')].map(c => c.dataset.level);
    const metadata = [...metaList.querySelectorAll('.filter-meta-row')].map(row => {
      const [ki, vi] = row.querySelectorAll('.filter-meta-input');
      const [bc, br] = row.querySelectorAll('.filter-toggle-btn');
      return { key: ki.value, value: vi.value, caseSensitive: bc.classList.contains('active'), regex: br.classList.contains('active') };
    }).filter(m => m.key || m.value);
    return {
      type: typeSelect ? typeSelect.value : 'positive',
      query: { text: queryInput.value.trim(), caseSensitive: btnCase.classList.contains('active'), regex: btnRegex.classList.contains('active') },
      levels,
      metadata,
    };
  }

  function reset() {
    queryInput.value = '';
    btnCase.classList.remove('active');
    btnRegex.classList.remove('active');
    queryInput.placeholder = 'substring…';
    levelChips.querySelectorAll('.filter-level-chip').forEach(c => c.classList.remove('active'));
    metaList.innerHTML = '';
  }

  // ── Submit button (only when onAdd is provided) ───────────────────────────
  if (onAdd) {
    const submitBtn = document.createElement('button');
    submitBtn.className = 'filter-add-btn';
    submitBtn.textContent = addLabel;

    function doSubmit() {
      const rule = getCurrentRule();
      if (ruleIsEmpty(rule)) return;
      onAdd(rule);
      reset();
      queryInput.focus();
    }

    submitBtn.addEventListener('click', doSubmit);
    queryInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') doSubmit();
      if (e.key === 'Escape') form.dispatchEvent(new CustomEvent('filter:escape', { bubbles: true }));
    });
    form.appendChild(submitBtn);
  } else {
    queryInput.addEventListener('keydown', e => {
      if (e.key === 'Escape') form.dispatchEvent(new CustomEvent('filter:escape', { bubbles: true }));
    });
  }

  return { el: form, setQuery(text) { queryInput.value = text; queryInput.focus(); }, focus() { queryInput.focus(); }, getRule: getCurrentRule, reset };
}
