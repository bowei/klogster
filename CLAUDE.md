# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
make build      # compile the klogster binary
make test       # run all tests (Go + JavaScript)
make test-go    # Go tests only
make test-js    # JavaScript tests only (requires Node.js ≥ 18)

go test ./internal/logformat/...   # run a single Go package's tests
go run ./cmd --demo                # run locally without Kubernetes
```

UI tests use Playwright and live in `hack/`:
```bash
cd hack && ./run-ui-tests.sh
```

## Architecture

klogster is a Go server that streams logs from multiple sources and serves them via a browser UI.

**Data flow:**
1. `watcher.Manager` emits `PodEvent`s for each log source: `PodWatcher` (Kubernetes informer) for `k8s` groups, `FileWatcher` (emits once on startup) for `file` groups.
2. `streamer.Manager` receives those events and starts a `PodStreamer` per source. K8s sources use `k8sLogOpener` (Kubernetes streaming API); file sources use `fileLogOpener` (polls at EOF every 250 ms).
3. Each log line is parsed by `logformat.Detector`, written to `storage.Store` (ring buffer in memory + append to disk), and broadcast via `hub.Hub` to connected WebSocket clients.
4. The frontend (`web/static/`) connects over WebSocket, subscribes to pod streams, and renders panels.

**Key packages:**
- `internal/hub` — pub/sub broadcast to WebSocket clients; clients call `Subscribe`/`Unsubscribe` per container
- `internal/storage` — keeps the last 10,000 lines per source in a ring buffer; also appends to `<logdir>/<group>/<ns>:<pod>:<container>`
- `internal/logformat` — pluggable log format detection; add a new format by implementing `Format`, calling `Register` in `init()`, and nothing else changes
- `internal/watcher` — `PodWatcher` for Kubernetes label-selector groups; `FileWatcher` for local file groups; both feed the same `PodEvent` channel
- `internal/streamer` — one goroutine per source; `fileLogOpener` polls on EOF; reconnects on failure
- `internal/api` — HTTP server: `GET /api/groups`, `GET /api/logs`, `GET /ws` (WebSocket)

**Frontend (`web/static/`):**
- Vanilla JS ES modules, no build step
- `app.js` — WebSocket lifecycle, pause/resume buffer, state serialization to URL hash
- `panels.js` — tabbed log panel rendering, per-panel filters
- `focus.js` — cross-panel focus/highlight dialog (regexp patterns, context lines/time)
- `state.js` — serialize/restore UI state from URL hash
- `timeline.js` — timestamp alignment across panels

## Log format extension

To add a new log format: create a file in `internal/logformat/`, implement the `Format` interface (`Name()`, `Detect(line string) bool`, `Parse(line string) ParsedLine`), and call `logformat.Register` from an `init()` function. Registration order matters — more specific formats should register before less specific ones (`unstructured` is always last).

## Demo mode

`go run ./cmd --demo` seeds two log groups (`serverPods`, `databasePods`) with realistic pre-populated lines and does not require a kubeconfig or config file. Use this for UI development.
