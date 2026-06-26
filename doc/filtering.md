# Filtering

Many features allow the user to specify a filter on the log lines.
This doc describes a unified filter specification and UI.

Fitlers use:

* per-log filter
* focus
* events

## Definition

Log content filters:

By string:

* sub string match (case sensitive and case insensitive)
* regex match

By metadata field:

* Log level (info, debug, etc) -- multiple can be selected.
* Structure log field match (string match on value)

## Filter dialog component

This a sketch of what the filter/query dialog component should look like:

```
 Query: [        ] (case sensitive icon) (regex icon)
 Log level: [ ] all [ ] debug [ ] info [ ] warn [ ] error ...
 Metadata: (list of 0 or more)
 key [   ] value [    ] (case insensitive icon) (regex icon)
```