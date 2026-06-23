# klogster UI Reference

## Header

### Connection status dot
A small colored circle in the header shows WebSocket state: gray while connecting, green when live, red on error. It reconnects automatically with exponential backoff up to 30-second intervals.

### Pause / Resume (⏸ / ▶)
Pauses all live log updates across every panel. New lines arriving during the pause are buffered in memory; the button shows ▶ and hovering shows the count of buffered lines. Clicking ▶ flushes the buffer and resumes tailing. Useful for reading a burst of activity without the log scrolling away.

### Focus button
Opens the focus dialog (see [Focus](#focus)). The button turns accent-colored when any focus pattern is active.

### + Panel button
Creates a new empty panel column and makes it the active target for the next log source opened from the browser. See [Panel columns](#panel-columns).

### + Log button
Toggles the log browser sidebar (see [Log Browser](#log-browser)).

### ⚙ Settings
Opens the theme picker (see [Themes](#themes)).

### ? Help
Opens a keyboard shortcut and feature reference dialog. Pressing Escape closes it.

---

## Log Browser

A slide-in sidebar listing every discovered log source organized by log group. Polls `/api/groups` every 10 seconds to stay current.

- Clicking a log source opens it as a new tab in the currently focused panel column. If no columns exist, one is created automatically.
- Sources already open in any column are highlighted in the accent color.
- On open, 500 lines of recent history are back-filled so the tab is not empty.
- The ✕ button at the top of the sidebar closes it.

---

## Panels

### Panel columns
The main area is divided into one or more vertical columns. Each column holds one or more tabs. Only the active tab's log content is visible; all other tabs continue streaming in the background and become visible when clicked.

Clicking anywhere inside a column makes it the focused column — the target for the next pod opened from the browser. The **+ Panel** button adds a new empty column on the right and focuses it.

A column is removed automatically when its last tab is closed.

### Tabs
Each open pod/container gets a tab at the top of its column. The active tab has a colored top border. Tabs show the truncated pod name; hovering shows the full `group / namespace / pod / container` path in a tooltip.

- **Clicking a tab** switches the column to show that tab's log.
- **Dragging a tab** over another tab reorders them within the column.
- **Dragging a tab** onto a different column's tab bar moves it to that column.
- **✕ on a tab** closes the tab and unsubscribes from its log stream. If it was the last tab in the column, the column is removed.

### Panel label
The toolbar at the top of each tab's content shows the full `group / namespace / pod / container` path.

### Log lines
Each line shows:
- **Timestamp** — formatted as `YYYY-MM-DD HH:MM:SS.ffffff`, fixed-width column on the left.
- **Level badge** — colored `INFO` / `WARN` / `ERROR` / `FATAL` / `DEBUG` / `TRACE` badge, shown only when the log source emits structured levels.
- **Message** — main log text, word-wrapped.
- **Structured fields** — key: value pairs indented below the message when present (e.g. slog or JSON-structured logs).

### Merged view

Each panel column has a **⊕** button on the right side of its tab bar. Clicking it enters merged view:

- All tabs in the column are hidden and replaced by a single combined log stream.
- Lines from every tab are merged and sorted by timestamp.
- Each line has a **source label** (`pod/container`) to the left of the message body so you can tell which log stream a line came from.
- The panel label changes to **Merged Logs** and the footer shows the total combined line count.
- **Per-tab filters are preserved**: lines filtered out on an individual tab are also hidden in the merged view. The filter button on each individual tab continues to control which lines from that source appear.
- The ⊕ button turns accent-colored while merged. Click it again, or click any tab, to return to the normal single-tab view.

State persistence includes the merged flag: reloading the page restores merged columns in merged mode after their history is back-filled.

### Footer
Shows `N lines · last: X ago` where the relative time (`seconds`, `minutes`, `hours`) updates every second. Gives a quick read on whether the log source is still active.

### Auto-scroll (live tail)
When the user is scrolled within 40 px of the bottom, new lines automatically scroll into view. Scrolling up disengages live tail; scrolling back to the bottom re-engages it.

### Line pruning
When a panel accumulates more than 5 000 lines, the oldest 1 000 are removed to keep memory and DOM size bounded.

---

## Scroll Synchronization

### Sync / Free toggle (⟷ sync / ⟷ free)
Each panel toolbar has a scroll-lock button. In **sync** mode (default, labeled **⟷ sync**) the panel participates in timestamp-aligned scrolling. In **free** mode (labeled **⟷ free**) it scrolls independently.

### Debounced cross-panel sync
When a locked panel is scrolled, klogster waits for scrolling to stop (100 ms of inactivity) before syncing the other locked panels. This avoids continuous DOM updates while the user is rapidly scrolling. Once the pause is detected, the top-most visible timestamp in the source panel is found, and every other locked panel jumps to its nearest matching timestamp using binary search.

### Timestamp crosshair
Hovering over any log line shows an orange horizontal line in all other panels at the position of the closest matching timestamp. If that timestamp is above or below the other panel's viewport, a small edge marker (▲ or ▼) appears at the top or bottom edge instead.

---

## Focus

Focus filters all panels simultaneously, keeping only lines that match one or more regexp patterns plus an optional window of surrounding context.

### Adding patterns
Type a regexp in the input and click **Add** (or press Enter). Patterns are case-insensitive. An invalid regexp shows a red error message and is not added. Multiple patterns are ORed together.

### Pattern list
Active patterns are listed with a × button to remove each individually. Removing the last pattern clears focus entirely.

### Context window
An optional window of surrounding lines or seconds shown around each match. The **Context** checkbox (unchecked by default) enables it. When unchecked, only exact matching lines are shown.

When context is enabled:

- **Type** — *Lines* (count-based) or *Seconds* (time-based).
- **Amount** — number of lines (0–200) or seconds (0–3600).
- **Direction** — *Around* (before and after), *Before*, or *After*.

### Match counter
While focus is active, the dialog shows `X of Y lines match` updated in real time across all panels.

### Highlighting
Matched text within visible lines is highlighted with a yellow background mark.

### Applied to new lines
Lines arriving from the live stream are immediately filtered and highlighted according to the current focus state.

### Lines omitted indicator

When focus filtering is active, we want to show a summary for
where the logs are filtered to give the user a sense of what
has been omitted.

When logs are filtered from being displayed, instead put a
dashed line with the time duration and lines skipped as a
a caption in place of the filtered lines:

```
2026-01-01 00:00:10.123 Log line ...
----------------------- (10 seconds, 5 lines skipped) --
2026-01-01 00:00:20.123 Log line ...
2026-01-01 00:00:30.123 Log line ...
```

## Per-Panel Filtering

Each panel has its own independent filter stack, separate from the global focus.

### Opening the filter dialog
Click the **filter** button in a panel's toolbar. When filters are active the button shows the count. Only one filter dialog is open at a time.

### Adding filters
Choose **+ show** (include only matching lines) or **− hide** (hide matching lines), enter a regexp, and click **Add** or press Enter. Filters are case-insensitive.

### Filter list
Each filter shows a green **+** or red **−** badge indicating its type, and a × to remove it. An invalid regexp is shown in red and has no effect.

### Closing
Click outside the dialog or press Escape.

---

## Text selection context menu

When log text is selected, after 100 ms, show a kebab icon next to the selected text that when clicked will open a context menu:

* Add text to filter: take the highlighted text and open the filter dialog, filling in the text as the regex pattern. This is a short-cut to cutting and pasting the text.
* Add text to focus: take the highlighted text and open the focus dialog, using the text as the regex pattern. This is a short-cut to cutting and pasting the text.

---

## Themes

Nine color themes are available in the ⚙ settings dialog, each previewed with color swatches:

- Dark (default)
- Light
- Pastel
- Monokai
- One Dark
- Dracula
- Gruvbox
- Nord
- Zenburn

The selected theme is persisted in `localStorage` and applied immediately via a `data-theme` attribute on the document root.

---

## State Persistence

The full UI state is encoded as base64 JSON in the URL hash and updated whenever tabs are opened, closed, moved, or filtered. Reloading the page or sharing the URL restores:

- Which panel columns exist and which tabs are in each column
- The active tab per column
- Whether each column is in merged view
- Per-tab filters
- Focus patterns and context settings
