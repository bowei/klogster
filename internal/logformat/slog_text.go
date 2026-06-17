package logformat

import (
	"strconv"
	"strings"
)

// SlogText parses Go's log/slog text handler format:
//
//	time=2024-01-16T10:00:00Z level=INFO msg="hello world" key=val

func init() { Register(SlogText{}) }

// SlogText implements Format for slog's text handler output.
type SlogText struct{}

func (SlogText) Name() string { return "slog-text" }

func (SlogText) Detect(line string) bool {
	return strings.HasPrefix(line, "time=") &&
		strings.Contains(line, " level=") &&
		strings.Contains(line, " msg=")
}

func (SlogText) Parse(line string) ParsedLine {
	p := ParsedLine{Raw: line, Level: "OTHER", Message: line}
	kv := parseKV(line)
	if level, ok := kv["level"]; ok {
		p.Level = normalizeSlogLevel(level)
	}
	if msg, ok := kv["msg"]; ok {
		p.Message = msg
	}
	delete(kv, "time")
	delete(kv, "level")
	delete(kv, "msg")
	delete(kv, "source")
	if len(kv) > 0 {
		p.Fields = kv
	}
	return p
}

// normalizeSlogLevel handles slog's level+offset notation, e.g. "INFO+1", "WARN-2".
func normalizeSlogLevel(s string) string {
	upper := strings.ToUpper(s)
	switch {
	case strings.HasPrefix(upper, "INFO"):
		return "INFO"
	case strings.HasPrefix(upper, "WARN"):
		return "WARN"
	case strings.HasPrefix(upper, "ERROR"):
		return "ERROR"
	case strings.HasPrefix(upper, "DEBUG"):
		return "DEBUG"
	case strings.HasPrefix(upper, "FATAL"):
		return "FATAL"
	case strings.HasPrefix(upper, "TRACE"):
		return "TRACE"
	}
	return normalizeLevel(s)
}

// parseKV parses a slog-style key=value string.
// String values may be quoted; unquoted values end at the next space.
func parseKV(s string) map[string]string {
	out := make(map[string]string)
	for len(s) > 0 {
		s = strings.TrimLeft(s, " \t")
		eq := strings.IndexByte(s, '=')
		if eq <= 0 {
			break
		}
		key := s[:eq]
		s = s[eq+1:]
		var val string
		if len(s) > 0 && s[0] == '"' {
			// Scan for the closing quote, respecting backslash escapes.
			i := 1
			for i < len(s) {
				if s[i] == '"' && s[i-1] != '\\' {
					i++
					break
				}
				i++
			}
			val, _ = strconv.Unquote(s[:i])
			s = s[i:]
		} else {
			sp := strings.IndexByte(s, ' ')
			if sp < 0 {
				sp = len(s)
			}
			val = s[:sp]
			s = s[sp:]
		}
		out[key] = val
	}
	return out
}
