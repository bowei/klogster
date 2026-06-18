import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveState, loadState } from './state.js';

// saveState calls history.replaceState(null, '', '#v2:...').
// loadState reads location.hash which browsers expose with the leading '#'.
let mockHash = '';
globalThis.location = { get hash() { return mockHash; } };
globalThis.history = { replaceState: (_s, _t, url) => { mockHash = url; } };

test('loadState returns null when hash is empty', () => {
  mockHash = '';
  assert.equal(loadState(), null);
});

test('loadState returns null with unrecognised prefix', () => {
  mockHash = '#other:data';
  assert.equal(loadState(), null);
});

test('loadState returns null for corrupt base64', () => {
  mockHash = '#v1:!!!invalid!!!';
  assert.equal(loadState(), null);
});

test('loadState returns null when panels is not an array', () => {
  mockHash = '#v1:' + btoa(JSON.stringify({ panels: null, focus: null }));
  assert.equal(loadState(), null);
});

test('saveState / loadState round-trips panelGroups and focus', () => {
  const panelGroups = [{
    merged: false,
    activeTab: { group: 'g', ns: 'default', pod: 'pod-1', container: 'c' },
    tabs: [{ group: 'g', ns: 'default', pod: 'pod-1', container: 'c', filters: [] }],
  }];
  const focus = { active: false, pattern: '' };
  saveState(panelGroups, focus);
  const result = loadState();
  assert.deepEqual(result.panelGroups, panelGroups);
  assert.deepEqual(result.focus, focus);
});

test('loadState preserves focus fields', () => {
  const focus = { active: true, pattern: 'error', contextType: 'line', contextAmount: 5 };
  saveState([], focus);
  assert.deepEqual(loadState().focus, focus);
});
