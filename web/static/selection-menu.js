import { findTabContaining, openFilterDialogWithPattern } from './panels.js';
import { openFocusDialogWithPattern } from './focus.js';

let kebabEl = null;
let menuEl = null;
let capturedText = '';
let capturedTab = null;
let debounceTimer = null;

function hideAll() {
  if (menuEl) { menuEl.remove(); menuEl = null; }
  if (kebabEl) { kebabEl.remove(); kebabEl = null; }
  capturedText = '';
  capturedTab = null;
}

function getLogEntry(node) {
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  return el?.closest('.log-entry') ?? null;
}

function showKebab(text, rect, tab) {
  capturedText = text;
  capturedTab = tab;

  if (kebabEl) kebabEl.remove();
  if (menuEl) { menuEl.remove(); menuEl = null; }

  kebabEl = document.createElement('button');
  kebabEl.className = 'sel-kebab';
  kebabEl.textContent = '⋮';
  kebabEl.style.top = `${rect.top}px`;
  kebabEl.style.left = `${rect.right + 4}px`;

  kebabEl.addEventListener('mousedown', e => {
    e.preventDefault();
    e.stopPropagation();
    if (menuEl) { menuEl.remove(); menuEl = null; return; }
    openMenu();
  });

  document.body.appendChild(kebabEl);
}

function openMenu() {
  const rect = kebabEl.getBoundingClientRect();

  menuEl = document.createElement('div');
  menuEl.className = 'sel-menu';
  menuEl.style.top = `${rect.bottom + 2}px`;
  menuEl.style.left = `${rect.left}px`;

  const items = [];
  if (capturedTab) items.push({ label: 'Add to filter', fn: doAddToFilter });
  items.push({ label: 'Add to focus', fn: doAddToFocus });

  for (const { label, fn } of items) {
    const btn = document.createElement('button');
    btn.className = 'sel-menu-item';
    btn.textContent = label;
    btn.addEventListener('mousedown', e => {
      e.preventDefault();
      e.stopPropagation();
      fn();
      hideAll();
    });
    menuEl.appendChild(btn);
  }

  document.body.appendChild(menuEl);
}

function doAddToFilter() {
  if (capturedTab) openFilterDialogWithPattern(capturedTab, capturedText);
}

function doAddToFocus() {
  openFocusDialogWithPattern(capturedText);
}

export function initSelectionMenu() {
  document.addEventListener('selectionchange', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) {
        hideAll();
        return;
      }

      const range = sel.getRangeAt(0);
      const logEntry = getLogEntry(range.startContainer);
      if (!logEntry) { hideAll(); return; }

      const rects = range.getClientRects();
      if (!rects.length) { hideAll(); return; }

      const last = rects[rects.length - 1];
      const tab = findTabContaining(logEntry);
      showKebab(sel.toString().trim(), last, tab);
    }, 100);
  });

  // Close menu when clicking outside it
  document.addEventListener('mousedown', e => {
    if (!menuEl) return;
    if (!menuEl.contains(e.target) && e.target !== kebabEl) {
      menuEl.remove();
      menuEl = null;
    }
  }, true);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && (menuEl || kebabEl)) hideAll();
  });
}
