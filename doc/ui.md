# klogster UI Reference

## Header

### Connection status dot
A small colored circle in the header shows WebSocket state: gray while connecting, green when live, red on error. It reconnects automatically with exponential backoff up to 30-second intervals.

### Pause / Resume (⏸ / ▶)
Pauses all live log updates across every panel. New lines arriving during the pause are buffered in memory; the button shows ▶ and hovering shows the count of buffered lines. Clicking ▶ flushes the buffer and resumes tailing. Useful for reading a burst of activity without the log scrolling away.

### Focus button
Opens the focus dialog (see [Focus](#focus)). The button turns accent-colored when any focus filter is active.

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

When a column has no open tabs — either because it was just created with **+ Panel** or because its last tab was closed — it shows a centered **close panel** button. Clicking it removes the column.

### Tabs
Each open pod/container gets a tab at the top of its column. The active tab has a colored top border. Tabs show the truncated pod name; hovering shows the full `group / namespace / pod / container` path in a tooltip.

- **Clicking a tab** switches the column to show that tab's log.
- **Dragging a tab** over another tab reorders them within the column.
- **Dragging a tab** onto a different column's tab bar moves it to that column.
- **✕ on a tab** closes the tab and unsubscribes from its log stream. If it was the last tab in the column, the column enters the empty state (see above).

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

Focus filters all panels simultaneously, keeping only lines that match one or more filters plus an optional window of surrounding context.

### Adding filters
Compose a filter using any combination of:

- **Query** — substring or regexp, with **Aa** (case-sensitive) and **.\*** (regexp mode) toggles. Default is case-insensitive substring.
- **Level** — click one or more level chips (DEBUG, INFO, WARN, ERROR, FATAL, TRACE) to restrict to those levels only.
- **Fields** — key/value rows for structured log fields, each with its own Aa and .* toggles. Click **+ add field** to add a row.

Click **Add** (or press Enter in the query box) to add the composed filter. Multiple filters are ORed: a line is visible if it matches any one of them.

### Filter list
Active filters are listed with a summary and a × button to remove each individually. Removing the last filter clears focus entirely.

### Context window
An optional window of surrounding lines or seconds shown around each match. The **Context** checkbox (unchecked by default) enables it. When unchecked, only exact matching lines are shown.

When context is enabled:

- **Type** — *Lines* (count-based) or *Seconds* (time-based).
- **Amount** — number of lines (0–200) or seconds (0–3600).
- **Direction** — *Around* (before and after), *Before*, or *After*.

### Match counter
While focus is active, the dialog shows `X of Y lines match` updated in real time across all panels.

### Highlighting
Query text from active filters is highlighted with a yellow background mark within visible lines.

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
Choose **+ show** (keep only matching lines) or **− hide** (remove matching lines) from the type selector. Then compose the filter using any combination of:

- **Query** — substring or regexp, with **Aa** (case-sensitive) and **.\*** (regexp mode) toggles. Default is case-insensitive substring.
- **Level** — click one or more level chips (DEBUG, INFO, WARN, ERROR, FATAL, TRACE) to restrict to those levels only.
- **Fields** — key/value rows for structured log fields, each with its own Aa and .* toggles. Click **+ add field** to add a row.

Click **Add filter** (or press Enter in the query box) to add the composed filter. Multiple positive filters are ORed: a line is visible if it matches any of them. Negative filters hide any line that matches.

### Filter list
Each filter shows a green **+** or red **−** badge indicating its type, a summary of what it matches, and a × to remove it.

### Closing
Click outside the dialog or press Escape.

---

## Text selection context menu

When log text is selected, after 100 ms, show a kebab icon next to the selected text that when clicked will open a context menu:

* Add text to filter: take the highlighted text and open the filter dialog, filling in the text as the regex pattern. This is a short-cut to cutting and pasting the text.
* Add text to focus: take the highlighted text and open the focus dialog, using the text as the regex pattern. This is a short-cut to cutting and pasting the text.

---

## Events

The **Events** button in the header opens the event template manager. Event templates match log lines using the unified filter component and annotate them with a colored icon in the log view.

### Event templates

Each template has:

- **Name** — a human-readable label shown in the icon tooltip.
- **Match** — a filter composed using any combination of query (substring or regexp with Aa and .* toggles), log level chips, and structured field key/value rows (with their own Aa and .* toggles). A line must satisfy all non-empty parts of the filter to be considered a match. Field rows whose keys appear in the matched line's structured data are captured as metadata values shown in the tooltip.
- **Link** — an optional parent template. When set, this template only fires on log lines that occur while a matching event from the parent template is still active (see Active duration below). If the parent template captures metadata fields (e.g. `req_id`), the child event only links to a parent event whose captured values for those same fields match. See [Linked templates](#linked-templates).
- **Icon** — a visual marker shown in the log for matching lines. Choose from the built-in picker (colored circles `●`, stars `★`, or exclamation marks `!` in eight colors, plus a row of emoji) or fine-tune with the color swatch beneath the grid.
- **Color** — used for the icon (symbols only; emoji render in their own colors) and for the active-duration border (see below).
- **Active duration** — how long after the match to highlight subsequent lines:
  - *None* (default) — icon only, no range highlight.
  - *Until end of log* — all lines after the match are highlighted.
  - *Custom* — lines within N milliseconds of the match timestamp are highlighted.

### Enabling and disabling

The **Enabled** checkbox at the top of the dialog toggles event processing without modifying the templates. When disabled, no icons are shown and no annotations are applied. When re-enabled, all visible log lines are re-annotated immediately.

### Managing templates

- **+ Add Template** opens an inline form to create a new template. Saving it automatically enables event processing if it was off.
- **edit** on a listed template opens the same form pre-filled for editing.
- **×** on a listed template deletes it immediately and removes its annotations from all open panels. Any child templates linked to the deleted template revert to standalone (their Link is cleared).
- Changes take effect immediately: all open log panels are re-scanned and annotated when templates are added, edited, deleted, or when the Enabled toggle changes.

The template list displays linked templates in a tree. A child template appears indented under its parent with a `∟` prefix:

```
● Request       [edit] ×
∟ ● Response    [edit] ×
∟ ∟ ● Retry     [edit] ×
```

### Event column in the log view

When at least one event template is active, every log line gets a fixed-width event column between the timestamp and the level badge. Lines that match one or more templates show the matching template icons in that column; lines with no match leave the column empty. This keeps all columns aligned regardless of whether a line matched.

Up to three icons are shown per line. If more templates match, a `+N` overflow label appears.

### Icon tooltip

Hovering an event icon shows a small tooltip with:

- The template name in bold.
- A table of the field keys specified in the template's match filter and the values from that specific log line.
- `→ ParentName` — shown in accent color when this event is a child linked to a parent event.
- `← ChildName` — shown in muted color for each child event that has linked back to this event (one line per child).

### Linked event navigation

Clicking an event icon that has any linked relationship opens a small popup showing the event name, its metadata, and navigation buttons:

- **Linked to: [parent name]** — shown when this event is a child. Clicking navigates to the parent event's log line.
- **Linked from: [child name]** — shown for each child event linked to this one. Clicking navigates to that child's log line.

Multiple "Linked from" rows appear if several child events linked to the same parent. Navigating scrolls the target line into view and briefly highlights it with a flash animation.

### Linked templates

A child template only fires when a parent event is currently active — that is, when an event from the parent template occurred earlier (in any open log) and its active duration has not yet expired. Matching is evaluated **across all open logs in timestamp order**, so parent and child events can live in completely separate log streams.

This makes it possible to model correlated pairs or chains even across different services:

- **Request / Response** — a "Request" template (active for 10 s) in the client log, with a "Response" template linked to it in the server log. Each response event is automatically associated with the matching open request.
- **Trace spans** — a root span template active for the duration of a trace, with child span templates linked to it across multiple service logs.

**Metadata matching** — if both the parent and child templates capture a structured field with the same key (e.g. `req_id`), a child event only links to a parent event whose captured value for that key is identical. This ensures that, for example, a response with `req_id=456` links to the request with `req_id=456` rather than any other open request.

If no shared metadata keys exist between parent and child, any active parent event matches.

### Active-duration highlighting

When a template has an active duration set, lines that fall within the specified time window after a matching line receive a colored left-border highlight in the template's color. This visually brackets the interval that began with the event — for example, the span of a request, a deployment rollout, or a retry window.

For historical lines loaded on panel open, the full range is computed in one pass. For live lines arriving over the WebSocket, ranges are tracked incrementally so newly arriving lines within an active window are highlighted as they appear.

### Event timeline

When event processing is active, a horizontal timeline strip appears between the header and the log panels. It shows every matched event across all open logs positioned at its timestamp on a time axis.

**Layout**

- Time runs left to right.
- Each event is represented by its icon placed at the corresponding position on the axis.
- When multiple events fall within the same time bucket (determined by the current zoom level), they are stacked vertically — earliest at top, latest nearest the axis.
- If a bucket contains 6 or more events, the first 5 icons are shown and a `+N` label appears below them. Clicking `+N` opens a list of all events in that bucket.

**Navigation**

- Clicking an event icon scrolls the corresponding log panel to that line and briefly highlights it.

**Hover tooltip**

Hovering an event icon shows:

- The template name.
- The timestamp of the matching log line.
- The log source (`pod/container`).
- A table of field keys from the template's match filter and the values from that log line.

**Zoom and pan**

- **Scroll wheel** — zoom in and out, anchored to the cursor position.
- **Click and drag** — pan left and right along the time axis.

**Focus filter**

The timeline only shows events from log lines that are currently visible. Lines hidden by the focus filter are excluded from the timeline.

### Persistence

Event templates and the enabled/disabled state are stored in `localStorage` and restored automatically on page load. They are not included in the URL hash, so sharing a URL does not share event templates.

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
- Focus filters and context settings
