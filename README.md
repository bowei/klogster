# klogster

klogster is a GUI app written in Go that pulls logs from a Kubernetes cluster from a
set of Pods given by a list of namespace, pod label selectors.

## Command line

```
-logdir <dir>     directory to store logs (default: /tmp/klogster)
-cfg <file>       klogster config file (default: klogster.yaml)
-serve <ip:port>  address to serve the UI (default: :7070)
-demo             run with sample data instead of connecting to Kubernetes
```

## Config file

```yaml
- name: serverPods
  selectors:
    - namespace: server-ns
      labels:
        app: server

- name: databasePods
  selectors:
    - namespace: db-ns
      labels:
        app: mysql
    - namespace: backup-db-ns
      labels:
        app: postgres

- name: mixedPods
  selectors:
    - namespace: app-ns
      labels:
        app: worker
      containers:        # optional: stream only these containers
        - app
        - sidecar
```

The `containers` field is optional. When omitted, klogster streams all containers
in each matching pod. Each container is tracked as a separate log source.

## Functionality

klogster connects to the Kubernetes cluster configured in the standard kubeconfig.
Logs are streamed from matching pods and saved to `-logdir` organized as:

```
<logdir>/<log group name>/<namespace>:<pod name>:<container name>
```

The last 10,000 lines per pod are kept in memory for fast serving; the full stream is
appended to disk.

## Demo mode

Run without a Kubernetes cluster to explore the UI with sample data:

```
go run ./cmd --demo
```

This starts the server with two pre-populated log groups (`serverPods`, `databasePods`)
containing realistic timestamped log lines. No kubeconfig or config file is required.

## Log formats

klogster auto-detects the log format of each container's output stream by
sampling the first few lines. Once detected, the format is locked in for the
lifetime of that stream. Supported formats:

| Format | Detection | Example line |
|--------|-----------|--------------|
| **klog** | `[IWEF]MMDD HH:MM:SS.usec threadid file:line]` | `I0116 10:00:00.000000 1234 server.go:42] server started` |
| **slog text** | starts with `time=`, contains `level=` and `msg=` | `time=2024-01-16T10:00:00Z level=INFO msg="hello" port=8080` |
| **slog JSON** | starts with `{`, contains `"level":` and `"msg":` | `{"time":"2024-01-16T10:00:00Z","level":"INFO","msg":"hello"}` |
| **std log** | `YYYY/MM/DD HH:MM:SS` prefix | `2024/01/16 10:00:00 server started` |
| **unstructured** | fallback for any other text | `INFO server started on :8080` |

To add a new format, implement the `logformat.Format` interface in a new file
under `internal/logformat/` and call `logformat.Register` from an `init`
function. No other files need to change.

### Log line display

The timestamp should be separated on its own column on the side to make it
easier to read.

```
2026-01-01 00:11:22.123 | Log message...
2026-01-01 00:11:23.123 | Long log message that wrapped
                        | with more text
2026-01-01 00:11:24.123 | More logs...   
```

For logging formats that are structured fields should be display like this:

```
2026-01-01 00:11:22.123 | Message string.
                        | key1: value1
                        | key2: value2
```

## UI

* Logs are shown as a set of configurable tabbed panels, like in an editor.
* Tabs can be opened, closed, and dragged to reorder.
* Timestamps are aligned across panels when scrolling.
* The current view is saved in the URL hash — copy or bookmark the URL to
  restore the exact set of open panels, active tab, per-panel filters, and
  focus state on reload.

### Focus dialog

Put a "Focus" button to the left of the tabs to globally focus the logs
filter across all of the tabs.

The focus dialog will enable filtering of logs across all of the panels
in an intelligent way by filtering for the same string across all of the
logs. An example would be a trace UUID that appears in multiple logs.

Focus options:

* Regexp text to match for.
* Context: This will behave like `grep -C3` where a matching log line will
  also show log lines nearby. This should have the following options:
  * Line-based context: number of surrounding lines to show.
  * Time-based context: show surrounding log lines from within a
    particular time-bound.
  * Give context from before, around or after the matching log line
