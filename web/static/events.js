// events.js — Event template management, matching, and display.
import { ruleMatches, ruleIsEmpty, ruleSummary, buildFilterCompose } from './filter.js';

// ── Navigate callback (set by panels.js) ──────────────────────────────────────
let _navigateCb = null;
export function setNavigateCallback(fn) { _navigateCb = fn; }

const STORAGE_KEY = 'klogster:events';

const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7', '#06b6d4', '#ec4899'];

export const ICON_PRESETS = [
  ...COLORS.map(color => ({ icon: '●', color })),
  ...COLORS.map(color => ({ icon: '⮕', color })),
  ...COLORS.map(color => ({ icon: '⬅', color })),
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
  templates: [], // [{id, name, filter: {query,levels,metadata}, icon, color, activeDuration, linkedTo}]
};

// Migrate an old-format template (regexp+metadataKeys) to new filter format.
function migrateTemplate(t) {
  let out = t;
  if (!out.filter) {
    out = {
      ...out,
      filter: { type: 'positive', query: { text: out.regexp || '', caseSensitive: false, regex: true }, levels: [], metadata: [] },
      regexp: undefined,
      metadataKeys: undefined,
    };
  }
  if (!('linkedTo' in out)) out = { ...out, linkedTo: null };
  if (!('captureGroups' in out)) out = { ...out, captureGroups: [] };
  return out;
}

// WeakMap: entry element -> matched events array (for applyActiveDurations)
const entryEventsMap = new WeakMap();
// WeakMap: parent entry element -> [{childName, parentInstanceId, childEntryEl}]
// Maintained in parallel with entryEventsMap so tooltips can show links in both directions.
const parentLinksMap = new WeakMap();

// ── Active event tracker ───────────────────────────────────────────────────────
// One tracker per tab, passed into matchAndAnnotate so child events can find
// active parent events. active entries: {templateId, instanceId, name, metadata, endTs, entryEl}

export function createActiveEventsTracker() {
  return { active: [] };
}

// Single shared tracker across all tabs so child events can find parent events
// in a different log (e.g. client request log → server response log).
export const globalTracker = createActiveEventsTracker();

// Returns true if there are no shared metadata keys, or all shared keys have equal values.
function metadataMatches(parentMeta, childMeta) {
  for (const k of Object.keys(parentMeta)) {
    if (k in childMeta && parentMeta[k] !== childMeta[k]) return false;
  }
  return true;
}

// ── Matching ──────────────────────────────────────────────────────────────────

export function matchAndAnnotate(entry, text, tracker) {
  const col = entry.querySelector('.log-event-col');
  if (!col || !eventsState.enabled || !eventsState.templates.length) return null;

  const tsMs = entry.dataset.ts ? new Date(entry.dataset.ts).getTime() : 0;

  // Prune expired active events from tracker before checking links.
  if (tracker && tsMs) {
    tracker.active = tracker.active.filter(a => a.endTs === Infinity || a.endTs >= tsMs);
  }

  const matched = [];
  for (const tmpl of eventsState.templates) {
    if (!tmpl.filter || ruleIsEmpty(tmpl.filter)) continue;
    if (!ruleMatches(tmpl.filter, entry)) continue;

    // Collect metadata from matched structured fields.
    const metadata = {};
    if (tmpl.filter.metadata && entry.dataset.fields) {
      let fields = {};
      try { fields = JSON.parse(entry.dataset.fields); } catch {}
      for (const m of tmpl.filter.metadata) {
        if (m.key && m.key in fields) metadata[m.key] = String(fields[m.key]);
      }
    }

    // Extract capture groups from the query regexp (named groups auto, positional via captureGroups).
    if (tmpl.filter?.query?.regex && tmpl.filter.query.text) {
      try {
        const flags = tmpl.filter.query.caseSensitive ? '' : 'i';
        const re = new RegExp(tmpl.filter.query.text, flags);
        const logText = entry.querySelector('.log-msg')?.textContent || '';
        const m = re.exec(logText);
        if (m) {
          if (m.groups) {
            for (const [k, v] of Object.entries(m.groups)) {
              if (v !== undefined) metadata[k] = v;
            }
          }
          if (tmpl.captureGroups) {
            for (const { group, name } of tmpl.captureGroups) {
              if (name && m[group] !== undefined) metadata[name] = m[group];
            }
          }
        }
      } catch {}
    }

    // If linked to a parent template, require an active parent event with matching metadata.
    let linkedToInstance = null;
    if (tmpl.linkedTo) {
      if (!tracker) continue;
      const parents = tracker.active.filter(a => a.templateId === tmpl.linkedTo);
      if (!parents.length) continue;
      const parent = parents.find(a => metadataMatches(a.metadata, metadata));
      if (!parent) continue;
      linkedToInstance = { entryEl: parent.entryEl, name: parent.name, instanceId: parent.instanceId };
      // Register the reverse link so the parent tooltip can show its children.
      let revLinks = parentLinksMap.get(parent.entryEl);
      if (!revLinks) { revLinks = []; parentLinksMap.set(parent.entryEl, revLinks); }
      revLinks.push({ childName: tmpl.name, parentInstanceId: parent.instanceId, childEntryEl: entry });
    }

    const instanceId = crypto.randomUUID();
    const ev = {
      name: tmpl.name,
      icon: tmpl.icon ?? '',
      color: tmpl.color || '',
      activeDuration: tmpl.activeDuration ?? 0,
      metadata,
      instanceId,
      linkedToInstance,
    };
    matched.push(ev);

    // Register this event in the tracker so its children can find it.
    if (tracker && tmpl.activeDuration !== 0) {
      const endTs = !tsMs || tmpl.activeDuration === -1 ? Infinity : tsMs + tmpl.activeDuration;
      tracker.active.push({ templateId: tmpl.id, instanceId, name: tmpl.name, metadata, endTs, entryEl: entry });
    }
  }

  if (!matched.length) return null;

  entryEventsMap.set(entry, matched);
  entry.classList.add('has-events');
  // Serialize safely — linkedToInstance.entryEl is a DOM ref, strip it for JSON.
  entry.dataset.eventData = JSON.stringify(matched.map(ev => ({
    name: ev.name, icon: ev.icon, color: ev.color, activeDuration: ev.activeDuration,
    metadata: ev.metadata, instanceId: ev.instanceId,
    linkedToInstance: ev.linkedToInstance
      ? { name: ev.linkedToInstance.name, instanceId: ev.linkedToInstance.instanceId }
      : null,
  })));
  renderCol(col, matched);
  return matched;
}

export function clearEntryEvents(entry, tracker) {
  // Remove this entry's reverse links from any parent entries it was linked to.
  const evs = entryEventsMap.get(entry);
  if (evs) {
    for (const ev of evs) {
      if (!ev.linkedToInstance?.entryEl) continue;
      const parentLinks = parentLinksMap.get(ev.linkedToInstance.entryEl);
      if (!parentLinks) continue;
      const kept = parentLinks.filter(l => l.childEntryEl !== entry);
      if (kept.length) parentLinksMap.set(ev.linkedToInstance.entryEl, kept);
      else parentLinksMap.delete(ev.linkedToInstance.entryEl);
    }
  }
  parentLinksMap.delete(entry);

  const col = entry.querySelector('.log-event-col');
  if (col) col.innerHTML = '';
  entry.classList.remove('has-events');
  if (tracker) tracker.active = tracker.active.filter(a => a.entryEl !== entry);
  entryEventsMap.delete(entry);
  delete entry.dataset.eventData;
}

function renderCol(col, evs) {
  col.innerHTML = '';
  const visible = evs.filter(ev => ev.icon);
  for (const ev of visible.slice(0, 3)) {
    const span = document.createElement('span');
    span.className = 'log-event-icon';
    span.textContent = ev.icon;
    if (ev.color) span.style.color = ev.color;
    col.appendChild(span);
  }
  if (visible.length > 3) {
    const more = document.createElement('span');
    more.className = 'log-event-more';
    more.textContent = `+${visible.length - 3}`;
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
  if (!entry) return;

  // Prefer live map (has DOM refs); cloned merged-view entries fall back to JSON.
  const liveEvs = entryEventsMap.get(entry);
  const icons = [...entry.querySelectorAll('.log-event-icon')];
  const idx = icons.indexOf(icon);

  let ev;
  if (liveEvs) {
    ev = liveEvs[idx >= 0 ? idx : 0];
  } else if (entry.dataset.eventData) {
    try {
      const parsed = JSON.parse(entry.dataset.eventData);
      ev = parsed[idx >= 0 ? idx : 0];
    } catch { return; }
  }
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

  // Link annotations — only available from the live map (not serialized clones).
  if (liveEvs) {
    if (ev.linkedToInstance) {
      html += `<div class="event-tip-link event-tip-link--to">→ ${esc(ev.linkedToInstance.name)}</div>`;
    }
    const childLinks = (parentLinksMap.get(entry) || []).filter(l => l.parentInstanceId === ev.instanceId);
    for (const l of childLinks) {
      html += `<div class="event-tip-link event-tip-link--from">← ${esc(l.childName)}</div>`;
    }
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

// ── Click popup for linked events ─────────────────────────────────────────────

let linkPopEl = null;

function closeLinkPop() {
  linkPopEl?.remove();
  linkPopEl = null;
}

document.addEventListener('click', e => {
  const icon = e.target.closest('.log-event-icon');
  if (!icon) { closeLinkPop(); return; }

  const entry = icon.closest('.log-entry');
  if (!entry) return;

  const evs = entryEventsMap.get(entry);
  if (!evs) return;

  const icons = [...entry.querySelectorAll('.log-event-icon')];
  const idx = icons.indexOf(icon);
  const ev = evs[idx >= 0 ? idx : 0];
  if (!ev) return;

  const childLinks = (parentLinksMap.get(entry) || []).filter(l => l.parentInstanceId === ev.instanceId);
  if (!ev.linkedToInstance && !childLinks.length) return;

  e.stopPropagation();
  closeLinkPop();

  const pop = document.createElement('div');
  pop.className = 'event-link-popup';

  const nameEl = document.createElement('div');
  nameEl.className = 'event-tip-name';
  nameEl.textContent = ev.name;
  pop.appendChild(nameEl);

  const keys = Object.keys(ev.metadata || {});
  if (keys.length) {
    const tbl = document.createElement('table');
    tbl.className = 'event-tip-table';
    for (const k of keys) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td class="event-tip-key">${esc(k)}</td><td class="event-tip-val">${esc(ev.metadata[k])}</td>`;
      tbl.appendChild(tr);
    }
    pop.appendChild(tbl);
  }

  function makeNavRow(label, targetName, targetEntryEl) {
    const row = document.createElement('div');
    row.className = 'event-link-row';
    const btn = document.createElement('button');
    btn.className = 'event-link-btn';
    btn.textContent = targetName;
    btn.addEventListener('click', () => {
      closeLinkPop();
      if (targetEntryEl) {
        targetEntryEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        targetEntryEl.classList.add('log-entry--nav-flash');
        setTimeout(() => targetEntryEl.classList.remove('log-entry--nav-flash'), 1500);
      }
      _navigateCb?.(targetEntryEl);
    });
    row.appendChild(document.createTextNode(label));
    row.appendChild(btn);
    pop.appendChild(row);
  }

  if (ev.linkedToInstance) {
    makeNavRow('Linked to: ', ev.linkedToInstance.name, ev.linkedToInstance.entryEl);
  }
  for (const l of childLinks) {
    makeNavRow('Linked from: ', l.childName, l.childEntryEl);
  }

  document.body.appendChild(pop);
  linkPopEl = pop;

  const r = icon.getBoundingClientRect();
  pop.style.left = `${r.right + 6}px`;
  pop.style.top = `${r.top}px`;
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
    eventsState.templates = Array.isArray(data.templates)
      ? data.templates.map(migrateTemplate)
      : [];
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

    // Build tree: find roots and group children under their parent.
    const tmplById = new Map(eventsState.templates.map(t => [t.id, t]));
    const childrenOf = new Map();
    const roots = [];
    for (const t of eventsState.templates) {
      if (t.linkedTo && tmplById.has(t.linkedTo)) {
        if (!childrenOf.has(t.linkedTo)) childrenOf.set(t.linkedTo, []);
        childrenOf.get(t.linkedTo).push(t);
      } else {
        roots.push(t);
      }
    }

    function renderItem(t, depth) {
      const row = document.createElement('div');
      row.className = 'events-item' + (t.id === editingId ? ' events-item--editing' : '');
      if (depth > 0) row.style.paddingLeft = `${10 + depth * 16}px`;

      if (depth > 0) {
        const prefix = document.createElement('span');
        prefix.className = 'events-item-prefix';
        prefix.textContent = '∟';
        row.appendChild(prefix);
      }

      const iconEl = document.createElement('span');
      iconEl.className = 'events-item-icon' + (t.icon ? '' : ' events-item-icon--none');
      iconEl.textContent = t.icon || '—';
      if (t.icon && t.color) iconEl.style.color = t.color;

      const info = document.createElement('span');
      info.className = 'events-item-info';
      const nameEl = document.createElement('span');
      nameEl.className = 'events-item-name';
      nameEl.textContent = t.name;
      const reEl = document.createElement('span');
      reEl.className = 'events-item-re';
      reEl.textContent = t.filter ? ruleSummary(t.filter) : '';
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
        // Also clear linkedTo on any children so they become roots.
        eventsState.templates = eventsState.templates
          .filter(x => x.id !== t.id)
          .map(x => x.linkedTo === t.id ? { ...x, linkedTo: null } : x);
        if (editingId === t.id) { editingId = null; formEl.innerHTML = ''; }
        notifyChanged();
        renderList();
      });

      row.appendChild(iconEl);
      row.appendChild(info);
      row.appendChild(editBtn);
      row.appendChild(delBtn);
      listEl.appendChild(row);

      for (const child of (childrenOf.get(t.id) || [])) {
        renderItem(child, depth + 1);
      }
    }

    for (const root of roots) renderItem(root, 0);
  }

  function showForm(tmpl) {
    const isNew = !tmpl;
    const d = tmpl || { name: '', filter: null, icon: '●', color: '#4ec9b0', activeDuration: 0, linkedTo: null, captureGroups: [] };
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

    // Linked to
    const linkRow = addRow('Link');
    const linkSel = document.createElement('select');
    linkSel.className = 'events-select';
    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = '— standalone —';
    linkSel.appendChild(noneOpt);
    for (const other of eventsState.templates) {
      if (other.id === d.id) continue;
      const opt = document.createElement('option');
      opt.value = other.id;
      opt.textContent = other.name || '(unnamed)';
      if (d.linkedTo === other.id) opt.selected = true;
      linkSel.appendChild(opt);
    }
    linkRow.appendChild(linkSel);

    // Filter compose (positive-only, embedded — no submit button)
    const filterLabel = document.createElement('div');
    filterLabel.className = 'events-form-hdr events-form-filter-lbl';
    filterLabel.textContent = 'Match';
    formEl.appendChild(filterLabel);
    const compose = buildFilterCompose({ showType: false, initialRule: d.filter || null });
    formEl.appendChild(compose.el);

    // Icon picker
    let selectedIcon = d.icon ?? '';

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

    const pickerWrap = document.createElement('div');
    pickerWrap.className = 'events-icon-picker-wrap';

    const noneBtn = document.createElement('button');
    noneBtn.type = 'button';
    noneBtn.className = 'events-icon-option events-icon-none' + (selectedIcon === '' ? ' selected' : '');
    noneBtn.textContent = 'none';
    noneBtn.title = 'No icon — event is functional only (not shown in log or timeline)';
    noneBtn.addEventListener('click', () => {
      selectedIcon = '';
      noneBtn.classList.add('selected');
      for (const c of pickerGrid.children) c.classList.remove('selected');
    });
    pickerWrap.appendChild(noneBtn);

    const pickerGrid = document.createElement('div');
    pickerGrid.className = 'events-icon-picker';
    for (const preset of ICON_PRESETS) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'events-icon-option';
      cell.textContent = preset.icon;
      cell.style.color = preset.color;
      cell.title = preset.icon;
      if (selectedIcon !== '' && preset.icon === selectedIcon && preset.color === colorInput.value) {
        cell.classList.add('selected');
      }
      cell.addEventListener('click', () => {
        selectedIcon = preset.icon;
        colorInput.value = preset.color;
        noneBtn.classList.remove('selected');
        for (const c of pickerGrid.children) c.classList.remove('selected');
        cell.classList.add('selected');
      });
      pickerGrid.appendChild(cell);
    }
    pickerWrap.appendChild(pickerGrid);
    icRow.appendChild(icLbl);
    icRow.appendChild(pickerWrap);

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

    // Capture Groups
    const cgHdr = document.createElement('div');
    cgHdr.className = 'events-form-hdr events-capture-hdr';
    const cgHdrText = document.createElement('span');
    cgHdrText.textContent = 'Capture Groups';
    const cgAddBtn = document.createElement('button');
    cgAddBtn.type = 'button';
    cgAddBtn.className = 'events-capture-add';
    cgAddBtn.textContent = '+ add';
    cgHdr.appendChild(cgHdrText);
    cgHdr.appendChild(cgAddBtn);
    formEl.appendChild(cgHdr);

    const cgList = document.createElement('div');
    cgList.className = 'events-capture-list';
    formEl.appendChild(cgList);

    const cgHint = document.createElement('div');
    cgHint.className = 'events-capture-hint';
    cgHint.textContent = 'Tip: (?<name>…) in the regexp extracts automatically without adding rows here.';
    formEl.appendChild(cgHint);

    function addCaptureRow(group = '', name = '') {
      const row = document.createElement('div');
      row.className = 'events-capture-row';

      const groupInput = document.createElement('input');
      groupInput.type = 'number';
      groupInput.className = 'events-input events-capture-group';
      groupInput.min = '1';
      groupInput.placeholder = '#';
      groupInput.value = group;

      const arrow = document.createElement('span');
      arrow.className = 'events-capture-arrow';
      arrow.textContent = '→';

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'events-input events-capture-name';
      nameInput.placeholder = 'field name';
      nameInput.value = name;

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'events-btn events-btn--del';
      delBtn.textContent = '×';
      delBtn.addEventListener('click', () => row.remove());

      row.appendChild(groupInput);
      row.appendChild(arrow);
      row.appendChild(nameInput);
      row.appendChild(delBtn);
      cgList.appendChild(row);
    }

    for (const cg of (d.captureGroups || [])) addCaptureRow(cg.group, cg.name);
    cgAddBtn.addEventListener('click', () => {
      const rows = cgList.querySelectorAll('.events-capture-row');
      const nextGroup = rows.length + 1;
      addCaptureRow(nextGroup, '');
      cgList.lastElementChild?.querySelector('.events-capture-name')?.focus();
    });

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
      if (!name) return;
      const filter = compose.getRule();
      const linkedTo = linkSel.value || null;
      const captureGroups = [...cgList.querySelectorAll('.events-capture-row')].flatMap(row => {
        const g = parseInt(row.querySelector('.events-capture-group').value, 10);
        const n = row.querySelector('.events-capture-name').value.trim();
        return (n && g >= 1) ? [{ group: g, name: n }] : [];
      });

      let activeDuration = 0;
      if (durSel.value === '-1') activeDuration = -1;
      else if (durSel.value === 'custom') activeDuration = Math.max(1, parseInt(durInput.value, 10) || 1);

      const icon = selectedIcon;
      const color = colorInput.value;

      if (isNew) {
        const id = crypto.randomUUID();
        eventsState.templates.push({ id, name, filter, icon, color, activeDuration, linkedTo, captureGroups });
        if (!eventsState.enabled) { eventsState.enabled = true; enableCb.checked = true; }
      } else {
        const idx = eventsState.templates.findIndex(t => t.id === editingId);
        if (idx >= 0) {
          eventsState.templates[idx] = { ...eventsState.templates[idx], name, filter, icon, color, activeDuration, linkedTo, captureGroups };
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
