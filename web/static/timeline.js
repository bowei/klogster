// Timestamp-aligned scroll synchronization across panels.
//
// Each log line <span> carries data-ts (ISO 8601 string). On scroll we find
// the timestamp of the topmost visible line and scroll every other unlocked
// panel so that its nearest timestamp is at the top.

let syncInProgress = false;

/**
 * Returns the ISO timestamp string of the topmost visible log line in the
 * given panel log element, or null if none found.
 */
function topVisibleTimestamp(logEl) {
  const top = logEl.getBoundingClientRect().top;
  const spans = logEl.querySelectorAll('.log-line[data-ts]');
  for (const span of spans) {
    const rect = span.getBoundingClientRect();
    if (rect.bottom > top) {
      return span.dataset.ts || null;
    }
  }
  return null;
}

/**
 * Find the span in logEl whose data-ts is closest to targetTs (ISO string).
 * Uses binary search on the ordered list of spans.
 */
function findClosestSpan(logEl, targetTs) {
  const spans = logEl.querySelectorAll('.log-line[data-ts]');
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
 * Attach a scroll listener to a panel log element. When it scrolls,
 * all other visible, unlocked panels are aligned to the same timestamp.
 *
 * @param {HTMLElement} logEl  - the .panel-log div
 * @param {() => HTMLElement[]} getOtherLogs - function returning other .panel-log elements
 * @param {() => boolean} isLocked - returns true if this panel participates in sync
 */
export function attachScrollSync(logEl, getOtherLogs, isLocked) {
  logEl.addEventListener('scroll', () => {
    if (syncInProgress) return;
    if (!isLocked()) return;

    const anchorTs = topVisibleTimestamp(logEl);
    if (!anchorTs) return;

    syncInProgress = true;
    requestAnimationFrame(() => {
      for (const other of getOtherLogs()) {
        if (other === logEl) continue;
        if (!other._scrollLocked) continue;
        const span = findClosestSpan(other, anchorTs);
        if (span) {
          span.scrollIntoView({ block: 'start', behavior: 'instant' });
        }
      }
      syncInProgress = false;
    });
  }, { passive: true });
}
