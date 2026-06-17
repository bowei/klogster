package logformat

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// SlogJSON parses Go's log/slog JSON handler format:
//
//	{"time":"2024-01-16T10:00:00Z","level":"INFO","msg":"hello","key":"val"}

func init() { Register(SlogJSON{}) }

// SlogJSON implements Format for slog's JSON handler output.
type SlogJSON struct{}

func (SlogJSON) Name() string { return "slog-json" }

func (SlogJSON) Detect(line string) bool {
	return len(line) > 0 && line[0] == '{' &&
		strings.Contains(line, `"level":`) &&
		strings.Contains(line, `"msg":`)
}

func (SlogJSON) Parse(line string) ParsedLine {
	p := ParsedLine{Raw: line, Level: "OTHER", Message: line}
	var m map[string]any
	if err := json.Unmarshal([]byte(line), &m); err != nil {
		return p
	}
	if t, ok := m["time"].(string); ok {
		if ts, err := time.Parse(time.RFC3339Nano, t); err == nil {
			p.Timestamp = ts
		}
	}
	if level, ok := m["level"].(string); ok {
		p.Level = normalizeSlogLevel(level)
	}
	if msg, ok := m["msg"].(string); ok {
		p.Message = msg
	}
	fields := make(map[string]string)
	for k, v := range m {
		if k == "time" || k == "level" || k == "msg" || k == "source" {
			continue
		}
		fields[k] = fmt.Sprint(v)
	}
	if len(fields) > 0 {
		p.Fields = fields
	}
	return p
}
