// events.js — Event template management, matching, and display.

const STORAGE_KEY = 'klogster:events';

const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7', '#06b6d4', '#ec4899'];

export const ICON_PRESETS = [
  ...COLORS.map(color => ({ icon: '●', color })),
  ...COLORS.map(color => ({ icon: '▶', color })),
  ...COLORS.map(color => ({ icon: '■', color })),
  ...COLORS.map(color => ({ icon: '◆', color })),
  // Emoji
  { icon: '🔥', color: '#f97316' },
  { icon: '⚡', color: '#eab308' },
  { icon: '⚠️', color: '#f97316' },
  { icon: '🚨', color: '#ef4444' },
  { icon: '💡', color: '#eab308' },
  { icon: '✅', color: '#22c55e' },
  { icon: '❌', color: '#ef4444' },
];

export const eventsState = {
  enabled: false,
  templates: [], // [{id, name, regexp, metadataKeys, icon, color, activeDuration}]
};

// Compiled regexp cache: template id -> RegExp | null
const reCache = new Map();

function compile(tmpl) {
  if (!reCache.has(tmpl.id)) {
    try { reCache.set(tmpl.id, new RegExp(tmpl.regexp)); }
    catch { reCache.set(tmpl.id, null); }
  }
  return reCache.get(tmpl.id);
}

function invalidate(id) {
  if (id != null) reCache.delete(id); else reCache.clear();
}

// WeakMap: entry element -> matched events array (for applyActiveDurations)
const entryEventsMap = new WeakMap();

// ── Matching ──────────────────────────────────────────────────────────────────

export function matchAndAnnotate(entry, text) {
  const col = entry.querySelector('.log-event-col');
  if (!col || !eventsState.enabled || !eventsState.templates.length) return null;

  const matched = [];
  for (const tmpl of eventsState.templates) {
    const re = compile(tmpl);
    if (!re) continue;
    re.lastIndex = 0;
    const m = re.exec(text);
    if (!m) continue;
    const metadata = {};
    (tmpl.metadataKeys || []).forEach((k, i) => {
      if (k) metadata[k] = m[i + 1] ?? '';
    });
    matched.push({
      name: tmpl.name,
      icon: tmpl.icon || '●',
      color: tmpl.color || '',
      activeDuration: tmpl.activeDuration ?? 0,
      metadata,
    });
  }

  if (!matched.length) return null;

  entryEventsMap.set(entry, matched);
  entry.classList.add('has-events');
  // Store as JSON for tooltip delegation (survives cloneNode)
  entry.dataset.eventData = JSON.stringify(matched);
  renderCol(col, matched);
  return matched;
}

export function clearEntryEvents(entry) {
  const col = entry.querySelector('.log-event-col');
  if (col) col.innerHTML = '';
  entry.classList.remove('has-events');
  entryEventsMap.delete(entry);
  delete entry.dataset.eventData;
}

function renderCol(col, evs) {
  col.innerHTML = '';
  for (const ev of evs.slice(0, 3)) {
    const span = document.createElement('span');
    span.className = 'log-event-icon';
    span.textContent = ev.icon;
    if (ev.color) span.style.color = ev.color;
    col.appendChild(span);
  }
  if (evs.length > 3) {
    const more = document.createElement('span');
    more.className = 'log-event-more';
    more.textContent = `+${evs.length - 3}`;
    col.appendChild(more);
  }
}

// ── Active duration ───────────────────────────────────────────────────────────

export function applyActiveDurations(logEl) {
  const entries = [...logEl.querySelectorAll('.log-entry')];

  for (const e of entries) {
    e.style.removeProperty('box-shadow');
    e.style.removeProperty('--event-active-color');
    e.classList.remove('log-entry--active');
  }

  if (!eventsState.enabled) return;

  for (let i = 0; i < entries.length; i++) {
    const evs = entryEventsMap.get(entries[i]);
    if (!evs) continue;
    const startTs = entries[i].dataset.ts ? new Date(entries[i].dataset.ts).getTime() : 0;
    if (!startTs) continue;

    for (const ev of evs) {
      if (ev.activeDuration === 0) continue;
      const endTs = ev.activeDuration === -1 ? Infinity : startTs + ev.activeDuration;
      for (let j = i + 1; j < entries.length; j++) {
        const next = entries[j];
        const nextTs = next.dataset.ts ? new Date(next.dataset.ts).getTime() : 0;
        if (nextTs && nextTs > endTs) break;
        next.classList.add('log-entry--active');
        next.style.setProperty('--event-active-color', ev.color || '#4ec9b0');
      }
    }
  }
}

// Rebuild tab.activeRanges from the current tail of the log so live lines
// appended after prependLines() get correct active-duration highlights.
export function rebuildActiveRanges(tab) {
  tab.activeRanges = [];
  const entries = [...tab.logEl.querySelectorAll('.log-entry')];
  const lastTs = entries.length
    ? (entries[entries.length - 1].dataset.ts
        ? new Date(entries[entries.length - 1].dataset.ts).getTime()
        : 0)
    : 0;

  for (const entry of entries) {
    const evs = entryEventsMap.get(entry);
    if (!evs) continue;
    const tsMs = entry.dataset.ts ? new Date(entry.dataset.ts).getTime() : 0;
    if (!tsMs) continue;
    for (const ev of evs) {
      if (ev.activeDuration === 0) continue;
      const endTs = ev.activeDuration === -1 ? Infinity : tsMs + ev.activeDuration;
      if (lastTs && endTs < lastTs) continue; // already expired
      tab.activeRanges.push({ endTs, color: ev.color || '#4ec9b0' });
    }
  }
}

// ── Tooltip (event-delegated so it works on cloned merged-view entries) ────────

let tipEl = null;

function getTip() {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.className = 'event-tooltip';
    document.body.appendChild(tipEl);
  }
  return tipEl;
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

document.addEventListener('mouseover', e => {
  const icon = e.target.closest('.log-event-icon');
  if (!icon) return;
  const entry = icon.closest('.log-entry');
  if (!entry || !entry.dataset.eventData) return;

  let evs;
  try { evs = JSON.parse(entry.dataset.eventData); } catch { return; }

  const icons = [...entry.querySelectorAll('.log-event-icon')];
  const idx = icons.indexOf(icon);
  const ev = evs[idx >= 0 ? idx : 0];
  if (!ev) return;

  const tip = getTip();
  let html = `<div class="event-tip-name">${esc(ev.name)}</div>`;
  const keys = Object.keys(ev.metadata || {});
  if (keys.length) {
    html += '<table class="event-tip-table">';
    for (const k of keys) {
      html += `<tr><td class="event-tip-key">${esc(k)}</td><td class="event-tip-val">${esc(ev.metadata[k])}</td></tr>`;
    }
    html += '</table>';
  }
  tip.innerHTML = html;

  const r = icon.getBoundingClientRect();
  tip.style.left = `${r.right + 6}px`;
  tip.style.top = `${r.top}px`;
  tip.classList.add('visible');
});

document.addEventListener('mouseout', e => {
  if (e.target.closest('.log-event-icon') && !e.relatedTarget?.closest('.log-event-icon')) {
    tipEl?.classList.remove('visible');
  }
});

// ── Storage ───────────────────────────────────────────────────────────────────

function saveToStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      enabled: eventsState.enabled,
      templates: eventsState.templates,
    }));
  } catch {}
}

export function initEvents() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    eventsState.enabled = Boolean(data.enabled);
    eventsState.templates = Array.isArray(data.templates) ? data.templates : [];
  } catch {}
  syncBodyClass();
}

// ── Button state ──────────────────────────────────────────────────────────────

export function updateEventsBtn(btn) {
  if (!btn) return;
  const n = eventsState.templates.length;
  if (eventsState.enabled && n > 0) {
    btn.textContent = `Events (${n})`;
    btn.classList.add('active');
  } else {
    btn.textContent = 'Events';
    btn.classList.remove('active');
  }
}

// ── Dialog ────────────────────────────────────────────────────────────────────

let activeDialog = null;
let eventsBtnEl = null;

function syncBodyClass() {
  document.body.classList.toggle('events-active', eventsState.enabled && eventsState.templates.length > 0);
}

function notifyChanged() {
  saveToStorage();
  syncBodyClass();
  updateEventsBtn(eventsBtnEl);
  document.dispatchEvent(new CustomEvent('events:changed'));
}

export function openEventsDialog(btn) {
  eventsBtnEl = btn;
  if (activeDialog) { activeDialog.remove(); activeDialog = null; return; }

  const dlg = document.createElement('div');
  dlg.className = 'events-dialog';
  activeDialog = dlg;

  // Header
  const hdr = document.createElement('div');
  hdr.className = 'events-dialog-hdr';

  const titleEl = document.createElement('span');
  titleEl.textContent = 'Event Templates';

  const enableLabel = document.createElement('label');
  enableLabel.className = 'events-enable-label';
  const enableCb = document.createElement('input');
  enableCb.type = 'checkbox';
  enableCb.checked = eventsState.enabled;
  enableCb.addEventListener('change', () => {
    eventsState.enabled = enableCb.checked;
    notifyChanged();
  });
  enableLabel.appendChild(enableCb);
  enableLabel.appendChild(document.createTextNode(' Enabled'));
  hdr.appendChild(titleEl);
  hdr.appendChild(enableLabel);
  dlg.appendChild(hdr);

  const listEl = document.createElement('div');
  listEl.className = 'events-list';
  dlg.appendChild(listEl);

  const formEl = document.createElement('div');
  formEl.className = 'events-form';
  dlg.appendChild(formEl);

  const addBtn = document.createElement('button');
  addBtn.className = 'events-add-btn';
  addBtn.textContent = '+ Add Template';
  addBtn.addEventListener('click', () => showForm(null));
  dlg.appendChild(addBtn);

  document.body.appendChild(dlg);
  positionDlg(btn, dlg);

  let editingId = null;

  function renderList() {
    listEl.innerHTML = '';
    if (!eventsState.templates.length) {
      const empty = document.createElement('div');
      empty.className = 'events-empty';
      empty.textContent = 'No templates yet';
      listEl.appendChild(empty);
      return;
    }
    for (const t of eventsState.templates) {
      const row = document.createElement('div');
      row.className = 'events-item' + (t.id === editingId ? ' events-item--editing' : '');

      const iconEl = document.createElement('span');
      iconEl.className = 'events-item-icon';
      iconEl.textContent = t.icon || '●';
      if (t.color) iconEl.style.color = t.color;

      const info = document.createElement('span');
      info.className = 'events-item-info';
      const nameEl = document.createElement('span');
      nameEl.className = 'events-item-name';
      nameEl.textContent = t.name;
      const reEl = document.createElement('span');
      reEl.className = 'events-item-re';
      reEl.textContent = t.regexp;
      info.appendChild(nameEl);
      info.appendChild(reEl);

      const editBtn = document.createElement('button');
      editBtn.className = 'events-btn';
      editBtn.textContent = 'edit';
      editBtn.addEventListener('click', () => { editingId = t.id; renderList(); showForm(t); });

      const delBtn = document.createElement('button');
      delBtn.className = 'events-btn events-btn--del';
      delBtn.textContent = '×';
      delBtn.addEventListener('click', () => {
        eventsState.templates = eventsState.templates.filter(x => x.id !== t.id);
        invalidate(t.id);
        if (editingId === t.id) { editingId = null; formEl.innerHTML = ''; }
        notifyChanged();
        renderList();
      });

      row.appendChild(iconEl);
      row.appendChild(info);
      row.appendChild(editBtn);
      row.appendChild(delBtn);
      listEl.appendChild(row);
    }
  }

  function showForm(tmpl) {
    const isNew = !tmpl;
    const d = tmpl || { name: '', regexp: '', metadataKeys: [], icon: '●', color: '#4ec9b0', activeDuration: 0 };
    formEl.innerHTML = '';

    const fhdr = document.createElement('div');
    fhdr.className = 'events-form-hdr';
    fhdr.textContent = isNew ? 'New Template' : 'Edit Template';
    formEl.appendChild(fhdr);

    function addRow(label) {
      const r = document.createElement('div');
      r.className = 'events-form-row';
      const lbl = document.createElement('span');
      lbl.className = 'events-form-lbl';
      lbl.textContent = label;
      r.appendChild(lbl);
      formEl.appendChild(r);
      return r;
    }

    function inp(type = 'text') {
      const i = document.createElement('input');
      i.type = type;
      i.className = 'events-input';
      return i;
    }

    const nameRow = addRow('Name');
    const nameInput = inp();
    nameInput.value = d.name;
    nameInput.placeholder = 'e.g. Request sent';
    nameRow.appendChild(nameInput);

    const reRow = addRow('Regexp');
    const reInput = inp();
    reInput.value = d.regexp;
    reInput.placeholder = 'e.g. Sent to client ([0-9]+)';
    reInput.className += ' events-re-input';
    reInput.spellcheck = false;
    reRow.appendChild(reInput);

    const reErr = document.createElement('div');
    reErr.className = 'events-re-err';
    formEl.appendChild(reErr);
    reInput.addEventListener('input', () => {
      try { new RegExp(reInput.value); reErr.textContent = ''; reInput.classList.remove('invalid'); }
      catch { reErr.textContent = 'Invalid regexp'; reInput.classList.add('invalid'); }
    });

    const keysRow = addRow('Keys');
    const keysInput = inp();
    keysInput.value = (d.metadataKeys || []).join(', ');
    keysInput.placeholder = 'key1, key2, … (one per capture group)';
    keysRow.appendChild(keysInput);

    // Icon picker
    let selectedIcon = d.icon || '●';

    // colorInput declared before picker so click handlers can update it
    const colorInput = inp('color');
    colorInput.value = d.color || '#ef4444';
    colorInput.className = 'events-color-input';

    const icRow = document.createElement('div');
    icRow.className = 'events-form-row events-form-picker-row';
    formEl.appendChild(icRow);
    const icLbl = document.createElement('span');
    icLbl.className = 'events-form-lbl';
    icLbl.textContent = 'Icon';

    const pickerGrid = document.createElement('div');
    pickerGrid.className = 'events-icon-picker';
    for (const preset of ICON_PRESETS) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'events-icon-option';
      cell.textContent = preset.icon;
      cell.style.color = preset.color;
      cell.title = preset.icon;
      if (preset.icon === selectedIcon && preset.color === colorInput.value) {
        cell.classList.add('selected');
      }
      cell.addEventListener('click', () => {
        selectedIcon = preset.icon;
        colorInput.value = preset.color;
        for (const c of pickerGrid.children) c.classList.remove('selected');
        cell.classList.add('selected');
      });
      pickerGrid.appendChild(cell);
    }
    icRow.appendChild(icLbl);
    icRow.appendChild(pickerGrid);

    // Color (fine-tune)
    const clrRow = addRow('Color');
    clrRow.appendChild(colorInput);

    // Duration
    const durRow = addRow('Active');
    const durSel = document.createElement('select');
    durSel.className = 'events-select';
    [['0', 'None (icon only)'], ['-1', 'Until end of log'], ['custom', 'Custom (ms)…']].forEach(([v, t]) => {
      const o = document.createElement('option');
      o.value = v; o.textContent = t;
      durSel.appendChild(o);
    });
    const durInput = inp('number');
    durInput.className = 'events-input events-dur-input';
    durInput.placeholder = 'ms';
    durInput.min = '1';

    const existing = d.activeDuration ?? 0;
    if (existing === 0) durSel.value = '0';
    else if (existing === -1) durSel.value = '-1';
    else { durSel.value = 'custom'; durInput.value = String(existing); }
    durInput.style.display = durSel.value === 'custom' ? '' : 'none';
    durSel.addEventListener('change', () => { durInput.style.display = durSel.value === 'custom' ? '' : 'none'; });
    durRow.appendChild(durSel);
    durRow.appendChild(durInput);

    // Buttons
    const btnRow = document.createElement('div');
    btnRow.className = 'events-form-btns';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'events-save-btn';
    saveBtn.textContent = isNew ? 'Add' : 'Save';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'events-cancel-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => { editingId = null; formEl.innerHTML = ''; renderList(); });
    btnRow.appendChild(saveBtn);
    btnRow.appendChild(cancelBtn);
    formEl.appendChild(btnRow);

    saveBtn.addEventListener('click', () => {
      const name = nameInput.value.trim();
      const regexp = reInput.value.trim();
      if (!name || !regexp) return;
      try { new RegExp(regexp); } catch { return; }

      let activeDuration = 0;
      if (durSel.value === '-1') activeDuration = -1;
      else if (durSel.value === 'custom') activeDuration = Math.max(1, parseInt(durInput.value, 10) || 1);

      const metadataKeys = keysInput.value.split(',').map(s => s.trim()).filter(Boolean);
      const icon = selectedIcon || '●';
      const color = colorInput.value;

      if (isNew) {
        const id = crypto.randomUUID();
        eventsState.templates.push({ id, name, regexp, metadataKeys, icon, color, activeDuration });
        if (!eventsState.enabled) { eventsState.enabled = true; enableCb.checked = true; }
      } else {
        const idx = eventsState.templates.findIndex(t => t.id === editingId);
        if (idx >= 0) {
          invalidate(eventsState.templates[idx].id);
          eventsState.templates[idx] = { ...eventsState.templates[idx], name, regexp, metadataKeys, icon, color, activeDuration };
        }
      }
      editingId = null;
      formEl.innerHTML = '';
      notifyChanged();
      renderList();
    });

    nameInput.focus();
  }

  renderList();

  function onOutside(e) {
    if (!dlg.contains(e.target) && e.target !== btn) {
      dlg.remove(); activeDialog = null;
      document.removeEventListener('mousedown', onOutside, true);
    }
  }
  setTimeout(() => document.addEventListener('mousedown', onOutside, true), 0);
}

function positionDlg(anchor, dlg) {
  const r = anchor.getBoundingClientRect();
  dlg.style.top = `${r.bottom + 4}px`;
  dlg.style.left = `${r.left}px`;
}
