package logformat

import (
	"strings"
	"time"
)

// ParsedLine holds structured data extracted from a single log line.
type ParsedLine struct {
	Timestamp time.Time         // zero if not present in the line
	Level     string            // INFO, WARN, ERROR, DEBUG, FATAL, TRACE, OTHER
	Message   string            // the main log message text
	Fields    map[string]string // key=value pairs; nil if not applicable
	Raw       string            // the original text passed to Parse
}

// Format detects and parses lines of a specific log format.
// Implementations should register themselves via Register in an init function.
type Format interface {
	Name() string
	// Detect returns true if line matches this format.
	Detect(line string) bool
	// Parse extracts structured fields from line.
	Parse(line string) ParsedLine
}

var registered []Format

// Register appends f to the global format list. Formats are evaluated in
// registration order during majority-vote detection, so more-specific formats
// should be registered before less-specific ones.
func Register(f Format) {
	registered = append(registered, f)
}

// All returns the registered formats in registration order.
func All() []Format {
	return registered
}

// normalizeLevel maps a raw level string to one of INFO, WARN, ERROR,
// DEBUG, FATAL, TRACE, or OTHER.
func normalizeLevel(s string) string {
	switch strings.ToUpper(strings.TrimSpace(s)) {
	case "INFO", "INFORMATION", "NOTE", "NOTICE", "LOG":
		return "INFO"
	case "WARN", "WARNING":
		return "WARN"
	case "ERROR", "ERR":
		return "ERROR"
	case "DEBUG", "DBG":
		return "DEBUG"
	case "FATAL", "CRITICAL":
		return "FATAL"
	case "TRACE":
		return "TRACE"
	default:
		return "OTHER"
	}
}

// extractLevelFromMessage looks for a level token at the start of an
// unstructured message, e.g. "INFO server started" → "INFO".
func extractLevelFromMessage(msg string) string {
	msg = strings.TrimLeft(msg, " \t")
	end := strings.IndexAny(msg, " \t")
	if end < 0 {
		end = len(msg)
	}
	token := strings.Trim(msg[:end], "[]():")
	return normalizeLevel(token)
}
