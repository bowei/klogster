// event-timeline.js — Horizontal event timeline strip shown when events are active.
//
// The timeline sits between the header and log panels. It shows event icons
// positioned at their timestamp, stacked vertically when they cluster together.
// Users can zoom (scroll wheel) and pan (click+drag) the time axis.

import { getAllEvents, setActivePanelByKey } from './panels.js';

const ICON_W = 20;       // px — quantization bucket width and icon cell width
const ICON_H = 20;       // px — icon row height
const AXIS_H = 20;       // px — space below icons for the axis line
const MAX_STACK = 5;     // max icons before showing ellipsis
const ZOOM_FACTOR = 1.2; // per scroll tick
const MIN_MS_PER_PX = 0.001;
const PAD_FRACTION = 0.05; // 5% padding on each side when fitting all events

let viewportEl = null;
let canvasEl = null;
let axisEl = null;

// View state: originMs is the timestamp at x=0 (left edge of canvas).
let viewState = { msPerPx: 1, originMs: 0 };
let allEvents = [];
let rafPending = false;
let isDragging = false;
let dragStartX = 0;
let dragStartOriginMs = 0;

// ── Tooltip (shared with events.js style) ────────────────────────────────────

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

function showTip(anchorEl, ev) {
  const tip = getTip();
  const ts = ev.ts ? new Date(ev.ts).toLocaleString([], { hour12: false }) : '—';
  const source = ev.tab ? `${ev.tab.pod}/${ev.tab.container}` : '';
  let html = `<div class="event-tip-name">${esc(ev.name)}</div>`;
  html += `<div class="event-tip-ts">${esc(ts)}</div>`;
  if (source) html += `<div class="event-tip-src">${esc(source)}</div>`;
  const keys = Object.keys(ev.metadata || {});
  if (keys.length) {
    html += '<table class="event-tip-table">';
    for (const k of keys) {
      html += `<tr><td class="event-tip-key">${esc(k)}</td><td class="event-tip-val">${esc(ev.metadata[k])}</td></tr>`;
    }
    html += '</table>';
  }
  tip.innerHTML = html;
  const r = anchorEl.getBoundingClientRect();
  // Position to the right, or flip left if too close to right edge
  const spaceRight = window.innerWidth - r.right - 6;
  if (spaceRight > 160) {
    tip.style.left = `${r.right + 6}px`;
  } else {
    tip.style.left = `${r.left - 170}px`;
  }
  tip.style.top = `${r.top}px`;
  tip.classList.add('visible');
}

function hideTip() {
  tipEl?.classList.remove('visible');
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function scheduleRender() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => { rafPending = false; renderTimeline(); });
}

function renderTimeline() {
  if (!canvasEl || !axisEl) return;

  const vpWidth = viewportEl.clientWidth;
  if (!vpWidth) return;

  const { msPerPx, originMs } = viewState;

  // Bucket in time-space so bucket boundaries don't shift as originMs changes.
  // Each bucket spans exactly bucketMs milliseconds; its index is stable across pans.
  const bucketMs = msPerPx * ICON_W;

  // Bucket all events (not just visible) so stacking is consistent across the
  // full timeline; we then filter to visible buckets for rendering.
  const buckets = new Map(); // bucketIndex (integer) -> [ev, ...]
  for (const ev of allEvents) {
    const bi = Math.floor(ev.tsMs / bucketMs);
    if (!buckets.has(bi)) buckets.set(bi, []);
    buckets.get(bi).push(ev);
  }

  // Sort each bucket chronologically
  for (const evs of buckets.values()) {
    evs.sort((a, b) => a.tsMs - b.tsMs);
  }

  // Compute pixel X for each bucket's left edge and discard off-screen buckets
  const visibleBuckets = new Map(); // pixelX -> evs
  for (const [bi, evs] of buckets) {
    const bx = (bi * bucketMs - originMs) / msPerPx;
    if (bx + ICON_W < 0 || bx > vpWidth) continue;
    visibleBuckets.set(bx, evs);
  }

  // Clear and rebuild
  canvasEl.innerHTML = '';

  for (const [bx, evs] of visibleBuckets) {
    const col = document.createElement('div');
    col.className = 'etl-stack';
    col.style.left = `${bx}px`;
    col.style.bottom = '0';

    const shown = evs.slice(0, MAX_STACK);
    const overflow = evs.length > MAX_STACK ? evs.slice(MAX_STACK) : null;

    for (const ev of shown) {
      const span = document.createElement('span');
      span.className = 'etl-icon';
      span.textContent = ev.icon || '●';
      if (ev.color) span.style.color = ev.color;
      span.title = ev.name;
      span.addEventListener('mouseover', () => showTip(span, ev));
      span.addEventListener('mouseout', hideTip);
      span.addEventListener('click', () => navigateTo(ev));
      col.appendChild(span);
    }

    if (overflow) {
      const more = document.createElement('span');
      more.className = 'etl-more';
      more.textContent = `+${overflow.length}`;
      more.addEventListener('click', e => openOverflowPopup(e, evs));
      col.appendChild(more);
    }

    canvasEl.appendChild(col);
  }

  renderAxis(vpWidth, originMs, originMs + vpWidth * msPerPx);
}

function renderAxis(vpWidth, minMs, maxMs) {
  axisEl.innerHTML = '';

  const rangeMs = maxMs - minMs;
  if (rangeMs <= 0) return;

  // Choose a tick interval that gives roughly 80–150px between ticks
  const targetPx = 100;
  const targetMs = targetPx * viewState.msPerPx;
  const magnitude = Math.pow(10, Math.floor(Math.log10(targetMs)));
  const candidates = [1, 2, 5, 10, 20, 50, 100, 200, 500];
  let tickMs = magnitude * candidates.find(c => magnitude * c >= targetMs) || magnitude * 1000;

  const firstTick = Math.ceil(minMs / tickMs) * tickMs;

  for (let t = firstTick; t <= maxMs; t += tickMs) {
    const x = (t - minMs) / viewState.msPerPx;

    const tick = document.createElement('div');
    tick.className = 'etl-tick';
    tick.style.left = `${x}px`;

    const label = document.createElement('span');
    label.className = 'etl-tick-label';
    label.textContent = formatTickLabel(t, tickMs);
    tick.appendChild(label);

    axisEl.appendChild(tick);
  }
}

function formatTickLabel(ms, intervalMs) {
  const d = new Date(ms);
  if (intervalMs >= 3_600_000) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  if (intervalMs >= 60_000) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  if (intervalMs >= 1_000) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) +
    '.' + String(d.getMilliseconds()).padStart(3, '0');
}

// ── Navigation ────────────────────────────────────────────────────────────────

function navigateTo(ev) {
  if (!ev.tab || !ev.entry) return;
  const { tab } = ev;
  setActivePanelByKey(tab.group, tab.ns, tab.pod, tab.container);
  ev.entry.scrollIntoView({ block: 'center', behavior: 'smooth' });
  ev.entry.classList.add('log-entry--jumped');
  setTimeout(() => ev.entry.classList.remove('log-entry--jumped'), 1500);
}

// ── Overflow popup ────────────────────────────────────────────────────────────

let overflowPopup = null;

function openOverflowPopup(e, evs) {
  e.stopPropagation();
  if (overflowPopup) { overflowPopup.remove(); overflowPopup = null; return; }

  const popup = document.createElement('div');
  popup.className = 'etl-overflow-popup';
  overflowPopup = popup;

  for (const ev of evs) {
    const row = document.createElement('div');
    row.className = 'etl-overflow-row';

    const icon = document.createElement('span');
    icon.className = 'etl-overflow-icon';
    icon.textContent = ev.icon || '●';
    if (ev.color) icon.style.color = ev.color;

    const info = document.createElement('span');
    info.className = 'etl-overflow-info';
    const ts = ev.ts ? new Date(ev.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '';
    info.textContent = `${ev.name}${ts ? ' · ' + ts : ''}`;

    row.appendChild(icon);
    row.appendChild(info);
    row.addEventListener('click', () => {
      navigateTo(ev);
      popup.remove();
      overflowPopup = null;
    });
    popup.appendChild(row);
  }

  document.body.appendChild(popup);

  // Position near the click
  const x = Math.min(e.clientX, window.innerWidth - 200);
  const y = e.clientY + 8;
  popup.style.left = `${x}px`;
  popup.style.top = `${y}px`;

  const dismiss = ev2 => {
    if (!popup.contains(ev2.target)) {
      popup.remove();
      overflowPopup = null;
      document.removeEventListener('mousedown', dismiss, true);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', dismiss, true), 0);
}

// ── Zoom and pan ──────────────────────────────────────────────────────────────

// Bounds derived from the current event set; updated by fitAllEvents().
let eventRangeMinMs = 0;
let eventRangeMaxMs = 0;

function maxMsPerPx() {
  // Zoomed-out limit: the full event span (plus padding) fills the viewport.
  const vpWidth = viewportEl.clientWidth || 800;
  const rangeMs = eventRangeMaxMs - eventRangeMinMs || 1000;
  const pad = rangeMs * PAD_FRACTION;
  return (rangeMs + 2 * pad) / vpWidth;
}

function fitAllEvents() {
  if (!allEvents.length || !viewportEl) return;
  const vpWidth = viewportEl.clientWidth || 800;
  eventRangeMinMs = Math.min(...allEvents.map(e => e.tsMs));
  eventRangeMaxMs = Math.max(...allEvents.map(e => e.tsMs));
  const rangeMs = eventRangeMaxMs - eventRangeMinMs || 1000;
  const pad = rangeMs * PAD_FRACTION;
  viewState.originMs = eventRangeMinMs - pad;
  viewState.msPerPx = (rangeMs + 2 * pad) / vpWidth;
}

function attachHandlers() {
  viewportEl.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = viewportEl.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorMs = viewState.originMs + cursorX * viewState.msPerPx;
    const factor = e.deltaY > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
    viewState.msPerPx = Math.min(maxMsPerPx(), Math.max(MIN_MS_PER_PX, viewState.msPerPx * factor));
    // Keep the time under the cursor fixed
    viewState.originMs = cursorMs - cursorX * viewState.msPerPx;
    scheduleRender();
  }, { passive: false });

  viewportEl.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    isDragging = true;
    dragStartX = e.clientX;
    dragStartOriginMs = viewState.originMs;
    viewportEl.style.cursor = 'grabbing';
    e.preventDefault();
  });

  document.addEventListener('mousemove', e => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartX;
    viewState.originMs = dragStartOriginMs - dx * viewState.msPerPx;
    scheduleRender();
  });

  document.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    viewportEl.style.cursor = '';
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

let refreshDebounceTimer = null;

export function initTimeline() {
  const outer = document.getElementById('event-timeline');
  if (!outer) return;

  viewportEl = document.createElement('div');
  viewportEl.id = 'etl-viewport';

  canvasEl = document.createElement('div');
  canvasEl.id = 'etl-canvas';

  axisEl = document.createElement('div');
  axisEl.id = 'etl-axis';

  viewportEl.appendChild(canvasEl);
  viewportEl.appendChild(axisEl);
  outer.appendChild(viewportEl);

  attachHandlers();
}

export function refreshTimeline() {
  clearTimeout(refreshDebounceTimer);
  refreshDebounceTimer = setTimeout(() => {
    allEvents = getAllEvents();
    if (!allEvents.length) return;
    fitAllEvents();
    scheduleRender();
  }, 300);
}

// Immediate refresh (for events:changed which already debounces itself via the
// panels.js listener that recomputes all annotations first).
export function refreshTimelineNow() {
  allEvents = getAllEvents();
  if (allEvents.length) fitAllEvents();
  scheduleRender();
}
