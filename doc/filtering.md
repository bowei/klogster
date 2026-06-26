# Filtering

klogster uses a unified filter component shared across per-panel filters,
Focus, and event template matching. A filter is composed of up to three parts
that are ANDed together — a line must satisfy every non-empty part to match.

## Filter parts

**Query** — a text pattern applied to the full log line:

- Default: case-insensitive substring match.
- **Aa** toggle: case-sensitive substring match.
- **.\*** toggle: treats the pattern as a regular expression.

**Level** — restrict to one or more log levels. Click level chips
(DEBUG, INFO, WARN, ERROR, FATAL, TRACE) to toggle them. When no chips are
selected, all levels pass. Only applies to log sources that emit structured
levels.

**Fields** — one or more key/value rows for structured log fields. Each row
has its own Aa (case-sensitive) and .* (regexp) toggles. A line matches a row
when the named field exists in the line's structured data and its value
satisfies the pattern. When multiple field rows are present, all must match.
Field values from matching rows are captured as metadata (shown in event
tooltips and focus highlights).

## Where it is used

- **Per-panel filter** — each panel has its own independent filter stack.
  Filters are either `+ show` (keep only matching lines) or `− hide` (remove
  matching lines). Multiple filters are ORed for `+ show` and independently
  applied for `− hide`.
- **Focus** — cross-panel filter. Multiple focus filters are ORed: a line is
  visible if it matches any one of them. An optional context window shows
  surrounding lines near each match.
- **Event templates** — each template's match field uses the same filter
  component. When the template fires, any structured field values named in the
  filter's Fields rows are captured as event metadata.
