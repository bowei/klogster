// Timestamp-aligned scroll synchronization across panels.
//
// Each log line <span> carries data-ts (ISO 8601 string). On scroll we find
// the timestamp of the topmost visible line and scroll every other unlocked
// panel so that its nearest timestamp is at the top.

/**
 * Returns the ISO timestamp string of the topmost visible log line in the
 * given panel log element, or null if none found.
 *
 * Uses elementFromPoint for an O(1) hit-test instead of allocating a NodeList
 * and scanning every entry with getBoundingClientRect.
 */
function topVisibleTimestamp(logEl) {
  const rect = logEl.getBoundingClientRect();
  // Probe just inside the top-left corner of the scroll area. Step down by 1px
  // until we land on an element (the first pixel may be a border/gap).
  for (let dy = 0; dy < 4; dy++) {
    const el = document.elementFromPoint(rect.left + 2, rect.top + dy);
    if (!el) continue;
    const entry = el.closest('.log-entry[data-ts]');
    if (entry) return entry.dataset.ts || null;
  }
  return null;
}

/**
 * Find the entry in logEl whose data-ts is closest to targetTs (ISO string).
 * Returns the first entry with ts >= targetTs, or the last entry if all are
 * earlier. Falls back to the last child when the search overshoots.
 *
 * Uses logEl.children (a browser-maintained HTMLCollection) instead of
 * querySelectorAll to avoid allocating a NodeList on every call. Entries
 * without data-ts are treated as '' and compare before all real timestamps.
 *
 * Note: the original "closest" comparison (targetTs - before) produced NaN
 * for ISO strings, so it always returned the >= side. This version makes
 * that behaviour explicit and fixes the undefined-return bug when lo was
 * past the end of the list.
 */
export function findClosestSpan(logEl, targetTs) {
  const children = logEl.children;
  const n = children.length;
  if (!n) return null;

  // Virtual-scroll containers have vs-spacer divs at index 0 and n-1.
  // Skip them so the binary search operates only on the sorted log entries.
  let start = 0, end = n;
  if (children[0]?.classList?.contains('vs-spacer')) start = 1;
  if (n > 1 && children[n - 1]?.classList?.contains('vs-spacer')) end = n - 1;
  if (start >= end) return null;

  let lo = start, hi = end;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((children[mid].dataset.ts || '') < targetTs) lo = mid + 1;
    else hi = mid;
  }

  // lo is the first entry with ts >= targetTs; fall back to last if past end.
  return children[lo] ?? children[end - 1];
}

/**
 * Show a horizontal crosshair in every panel except sourcePanel at the Y
 * position corresponding to the given ISO timestamp. If the timestamp falls
 * outside the panel's current viewport, shows a small edge marker instead.
 *
 * @param {string} ts - ISO timestamp to locate
 * @param {object} sourcePanel - the panel the user is hovering
 * @param {object[]} allPanels - all open panels (each with logEl, wrapEl, crosshairEl)
 */
export function showCrosshairs(ts, sourcePanel, allPanels) {
  for (const panel of allPanels) {
    if (panel === sourcePanel) continue;
    const span = findClosestSpan(panel.logEl, ts);
    if (!span) {
      panel.crosshairEl.style.display = 'none';
      continue;
    }

    const spanRect = span.getBoundingClientRect();
    const wrapRect = panel.wrapEl.getBoundingClientRect();
    const y = spanRect.top - wrapRect.top;

    panel.crosshairEl.style.display = 'block';
    if (y < 0) {
      panel.crosshairEl.dataset.edge = 'above';
      panel.crosshairEl.style.top = '0';
      panel.crosshairEl.style.bottom = '';
    } else if (y > wrapRect.height) {
      panel.crosshairEl.dataset.edge = 'below';
      panel.crosshairEl.style.top = '';
      panel.crosshairEl.style.bottom = '0';
    } else {
      delete panel.crosshairEl.dataset.edge;
      panel.crosshairEl.style.top = y + 'px';
      panel.crosshairEl.style.bottom = '';
    }
  }
}

/**
 * Hide all crosshair indicators across all panels.
 */
export function clearCrosshairs(allPanels) {
  for (const panel of allPanels) {
    panel.crosshairEl.style.display = 'none';
  }
}

export function attachScrollSync(logEl, getOtherLogs, isLocked) {
  let debounceTimer = null;

  logEl.addEventListener('scroll', () => {
    // Ignore scroll events that we ourselves triggered programmatically.
    if (logEl._programmaticScroll) {
      logEl._programmaticScroll = false;
      return;
    }
    if (!isLocked()) return;

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const anchorTs = topVisibleTimestamp(logEl);
      if (!anchorTs) return;

      requestAnimationFrame(() => {
        for (const other of getOtherLogs()) {
          if (other === logEl) continue;
          if (!other._scrollLocked) continue;
          if (other._scrollToTs) {
            // Virtual-scroll panel: jump by data-model index, no DOM span needed.
            other._scrollToTs(anchorTs);
          } else {
            const span = findClosestSpan(other, anchorTs);
            if (span) {
              other._programmaticScroll = true;
              span.scrollIntoView({ block: 'start', behavior: 'instant' });
            }
          }
        }
      });
    }, 100);
  }, { passive: true });

  return () => clearTimeout(debounceTimer);
}
