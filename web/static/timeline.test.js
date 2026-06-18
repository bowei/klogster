import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findClosestSpan } from './timeline.js';

// findClosestSpan only needs logEl.children and span.dataset.ts —
// no full DOM required. Arrays satisfy the indexed-access + .length interface.
function makeLogEl(timestamps) {
  const spans = timestamps.map(ts => ({ dataset: { ts } }));
  return { children: spans };
}

test('findClosestSpan returns null for empty log', () => {
  assert.equal(findClosestSpan(makeLogEl([]), '2024-01-01T10:00:00Z'), null);
});

test('findClosestSpan returns the only span', () => {
  const el = makeLogEl(['2024-01-01T10:00:00Z']);
  assert.equal(findClosestSpan(el, '2024-01-01T10:00:00Z').dataset.ts, '2024-01-01T10:00:00Z');
});

test('findClosestSpan returns first span when target is before all entries', () => {
  const el = makeLogEl(['2024-01-01T10:00:00Z', '2024-01-01T11:00:00Z', '2024-01-01T12:00:00Z']);
  assert.equal(findClosestSpan(el, '2024-01-01T09:00:00Z').dataset.ts, '2024-01-01T10:00:00Z');
});

test('findClosestSpan returns last span when target is after all entries', () => {
  const el = makeLogEl(['2024-01-01T10:00:00Z', '2024-01-01T11:00:00Z', '2024-01-01T12:00:00Z']);
  assert.equal(findClosestSpan(el, '2024-01-01T13:00:00Z').dataset.ts, '2024-01-01T12:00:00Z');
});

test('findClosestSpan returns exact match', () => {
  const el = makeLogEl(['2024-01-01T10:00:00Z', '2024-01-01T11:00:00Z', '2024-01-01T12:00:00Z']);
  assert.equal(findClosestSpan(el, '2024-01-01T11:00:00Z').dataset.ts, '2024-01-01T11:00:00Z');
});

test('findClosestSpan returns first span >= target when between two entries', () => {
  const el = makeLogEl(['2024-01-01T10:00:00Z', '2024-01-01T12:00:00Z']);
  assert.equal(findClosestSpan(el, '2024-01-01T11:00:00Z').dataset.ts, '2024-01-01T12:00:00Z');
});
