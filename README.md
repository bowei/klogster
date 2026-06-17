# klogster

klogster is a GUI app written in Go that pulls logs from a Kubernetes cluster from a
set of Pods given by a list of namespace, pod label selectors.

## Command line

-logdir `<dir>` to store the logs. default to `/tmp/klogster`.
-cfg `<config file>` for klogster. default to klogster.yaml.
-serve `<ip:port>`. default to :7070. where the UI will be served.

## Config file

```yaml
- name: serverPods # log group name
  - namespace: server-ns
    labels:
      app: server
- name: databasePods # log group name
  - namespace: db-ns # multiple selectors to watch
    labels:
      app: mysql
  - namespace: backup-db-ns
    labels:
      app: postgres
```

## Functionality

klogster connects to Kubernetes cluster configured in the standard kube config.
Each log will be streamed and saved to `-logdir` organized by:

`<log group name>/<ns>:<pod name>`

## UI

* The UI will show the logs as a set of configurable tabbed panels, like in an editor.
* Tabs can be opened, closed and dragged to change which logs are shown.
* Logs should be shown aligning timestamps across different panels when scrolling.