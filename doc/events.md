# Events

Event templates analyze log lines and annotate them with colored icons, making
it easy to spot and correlate significant events across multiple log streams.

## Event template fields

Each template has:

- **Name** — human-readable label shown in icon tooltips.
- **Match** — a filter using the same component as Focus and per-panel filters:
  a query (substring or regexp, with case-sensitive and regex-mode toggles),
  optional log-level chips, and optional structured field key/value rows. A
  line must satisfy all non-empty parts of the filter to match. Values of
  structured fields named in the filter are captured as metadata and shown in
  the tooltip.
- **Icon** — a visual marker placed next to matching lines. Choose from colored
  symbols (circles `●`, stars `★`, exclamation marks `!`) or emoji.
- **Color** — used for symbol icons and the active-duration left-border.
- **Active duration** — how long an Event is available for linking:
  - *None* (default) — icon only.
  - *Until end of log* — until end of logs.
  - *Custom* — lines within N milliseconds of the match.
- **Link** — optional parent template (see [Linked templates](#linked-templates)).

## Event display in the log view

When at least one template is active, a fixed-width event column appears
between the timestamp and the level badge on every line. Matching lines show
their icon(s) in that column; non-matching lines leave it blank, keeping all
columns aligned.

Up to three icons are shown per line; if more templates match, a `+N` overflow
label appears.

Hovering an icon shows a tooltip with:

- The template name.
- A table of structured field keys from the template's match filter and their
  values from that log line.
- Linked Events.

Clicking an icon that has any linked relationship opens a navigation popup with
**Linked to: [parent]** and **Linked from: [child]** buttons. Clicking a button
scrolls the target log line into view and briefly highlights it.

## Linked templates

A child template only fires on log lines that occur while a matching event from
the parent template is still active. Matching is evaluated **across all open
logs in timestamp order**, enabling correlations across separate log streams.

If both the parent and child templates name the same structured field (e.g.
`req_id`), a child event only links to the parent event whose captured value
matches — so a response with `req_id=456` links to the request with `req_id=456`
and not to any other open request.

Example:

```
client.log  00:00:01 INFO request  req_id=abc   <-- Request event, active 10 s
server.log  00:00:10 INFO response req_id=abc   <-- Response event, linked to the request above
```

Typical use cases:

- **Request / Response** — "Request" template active for 10 s in the client
  log; "Response" template linked to it in the server log.
- **Trace spans** — root span template active for the trace duration; child
  span templates linked across multiple service logs.

## Event template dialog

Open via the **Events** button in the header.

- **Enabled** checkbox at the top toggles all event processing without
  modifying templates. Re-enabling immediately re-annotates all visible lines.
- **+ Add Template** opens an inline form. Saving automatically enables event
  processing if it was off.
- **edit** pre-fills the form for an existing template.
- **×** deletes a template immediately and removes its annotations from all
  panels. Child templates linked to the deleted template revert to standalone.
- Changes take effect immediately across all open panels.

Templates linked to a parent are shown indented in the list:

```
● Request       [edit] ×
∟ ● Response    [edit] ×
∟ ∟ ● Retry     [edit] ×
```

## Event timeline

When event processing is active, a horizontal timeline strip appears between
the header and the log panels, showing every matched event across all open
logs positioned at its timestamp.

- Time runs left to right.
- Events that fall in the same time bucket (at the current zoom level) are
  stacked vertically, earliest at top.
- Buckets with 6 or more events show the first 5 icons and a `+N` label.
  Clicking `+N` lists all events in that bucket.
- **Scroll** to zoom in/out anchored to the cursor.
- **Drag** to pan along the time axis.
- **Click an icon** to scroll the corresponding log panel to that line and
  briefly highlight it.
- Hovering an icon shows the template name, timestamp, log source, and
  captured field values.

The timeline only shows events from lines that are currently visible; lines
hidden by the focus filter are excluded.

## Persistence

Event templates and the enabled/disabled state are stored in `localStorage`
and restored automatically on page load. They are not encoded in the URL hash,
so sharing a URL does not share event templates.
