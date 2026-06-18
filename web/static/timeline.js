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
 * Find the span in logEl whose data-ts is closest to targetTs (ISO string).
 * Uses binary search on the ordered list of spans.
 */
export function findClosestSpan(logEl, targetTs) {
  const spans = logEl.querySelectorAll('.log-entry[data-ts]');
  if (!spans.length) return null;

  let lo = 0, hi = spans.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (spans[mid].dataset.ts < targetTs) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  // lo is the first span with ts >= targetTs; check lo-1 for closest
  if (lo > 0 && lo < spans.length) {
    const before = spans[lo - 1].dataset.ts;
    const after = spans[lo].dataset.ts;
    return (targetTs - before < after - targetTs) ? spans[lo - 1] : spans[lo];
  }
  return spans[lo];
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
          const span = findClosestSpan(other, anchorTs);
          if (span) {
            // Set the flag before scrollIntoView so the resulting scroll event
            // is suppressed on the target panel and does not cascade back.
            other._programmaticScroll = true;
            span.scrollIntoView({ block: 'start', behavior: 'instant' });
          }
        }
      });
    }, 100);
  }, { passive: true });

  return () => clearTimeout(debounceTimer);
}
