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
```

## Functionality

klogster connects to the Kubernetes cluster configured in the standard kubeconfig.
Logs are streamed from matching pods and saved to `-logdir` organized as:

```
<logdir>/<log group name>/<namespace>:<pod name>
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

## UI

* Logs are shown as a set of configurable tabbed panels, like in an editor.
* Tabs can be opened, closed, and dragged to reorder.
* Timestamps are aligned across panels when scrolling.
