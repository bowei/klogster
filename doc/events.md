# Events

Give users a way to analyze log lines into Events derived from the log lines.

* An EventTemplate is a:
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
* Hovering over the event icon will show the event name and a small table of the metadata.