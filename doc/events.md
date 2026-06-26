# Events

Give users a way to analyze log lines into Events derived from the log lines.

An EventTemplate is a:

* name of the template.
* regexp to match against a log line.
* list of metadata keys to be extracted using the regexp from the log line. 
* Event icon
* Event color
* Active duration time
* -1: until end of log
* 0: not active (default)
* N > 0: active until N milliseconds after the timestamp.

If an EventTemplate regexp matches a log line, this creates an Event linked
with the log line:

  EventTemplate = {regexp: "Sent to client ([0-9]+)", metdata keys: ["client_id"] }

Matching:

  Log line = "2026-01-01 00:00:01 INFO Sent to client 123".

Would result in an Event linked to the log line with metadata client_id="123".

Logs will be analyzed with EventTemplates, iterating over the log lines to generate
Events. Events will then be used to show highlight derived events in the logs and
used for summary visualizations.

## Event fields

Each Event will have metadata associated with it:

* Name of the EventTemplate that matched it
* Any metadata keys derived from the regexp

## Linking Events

An EventTemplate A may be *linked* to another EventTemplate B. In this case, Events of A can occur during the period that Events of B are *active* and with matching metadata.

Linking is evaluated **across all open logs in timestamp order**, not just within a single log. This enables cross-log correlations such as a client request in one log being linked to its server response in another.

Linking is an optional dropdown in the Event creation dialog. The dropdown should be a list of the currently configured Events. When an Event is linked to another Event, it should be sorted to be displayed under the event in the Events list:

```
icon Event_1      [edit] x
∟ icon Event_2    [edit] x    <-- template is linked to Event_1
∟ icon Event_3    [edit] x    <-- template is linked to Event_2
```

The intuitive use of linked Events is to model things like protocol request/response pairs, or chains of linked Events for a trace_id — even when the two sides appear in different log streams.

Example:

* EventTemplate "Request" with field req_id, active for 10 s.
* EventTemplate "Response" with field req_id, linked to template "Request".

The following log lines (possibly from two separate logs):

```
client.log  00:00:01 Request req_id abc        <-- Event Request req_id = abc
server.log  00:00:10 Response req_id abc       <-- Event Response req_id = abc, linked to the Request at 00:00:01.
```

Events that are linked show the other Events they are connected to when clicked. Each linked event is clickable and will take you to the log line of the linked event. The relationship is shown in both directions: a child event shows "Linked to: [parent]" and a parent event shows "Linked from: [child]".

## Event template Dialog

* Open event template dialog button to the right of the "focus" button.
* Event template dialog shows the list of EventTemplates that exist.
* Checkbox to disable event processing/display without modifying the event templates.
* Dialog will allow the user to edit, add and remove EventTemplates.
* When the dialog is closed, any changes to the templates will recompute the Events
  derived from the template across the logs.

## Event display in the log view

* If events are active, show an extra column with the icon for the events for the given
  log line to the right of the timestamp column in the log lines that have matching events.
* Hovering over the event icon will show the event name, a small table of the metadata, and
  link arrows for any linked events:
  * `→ ParentName` (accent color) — this event is a child, linked to that parent.
  * `← ChildName` (muted color) — this event is a parent that a child has linked to.
* Clicking an event icon that has any links (in either direction) opens a persistent popup
  with "Linked to: [parent]" and/or "Linked from: [child]" buttons. Clicking a button
  navigates to that event's log line (scroll + brief highlight).

## Event timeline

If Events are enabled, show a horizontal timeline below the top menu bar above the log panels.

The timeline should show time going from left to right, zoomable via scroll wheel.
Show the event icon on the timeline when the Event occurred.

If multiple events occurred around the same time, show them as a vertical stack going 
from earliest event (top) to latest event (bottom). To make the visual display line up,
quantize where the event icons are displayed to the icon size so they visually stack.

```
     event_1
     event_2
     event_3

 <---|-----|-----|------> 
``` 

If there are more than 8 events on a given stack, show 7 icons and an ellipsis (...) that
when clicked opens the full list of events that occurred at that time period.

Hover over the event icon shows details:

* Timestamp
* Log where the event occurred
* Metadata

Clicking on the event icon will take you to the log line corresponding to the event.