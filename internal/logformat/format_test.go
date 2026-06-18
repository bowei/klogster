package logformat_test

import (
	"strings"
	"testing"

	"github.com/bowei/klogster/internal/logformat"
)

// ---- Klog ---------------------------------------------------------------

func TestKlogDetect(t *testing.T) {
	f := logformat.Klog{}
	pos := []string{
		"I0116 10:00:00.000000 1234 server.go:42] server started",
		"W0116 10:00:00.000000 1234 server.go:42] warning",
		"E0116 10:00:00.000000 1234 server.go:42] error",
		"F0116 10:00:00.000000 1234 server.go:42] fatal",
	}
	neg := []string{
		"INFO server started",
		`{"level":"INFO","msg":"hello"}`,
		`time=2024-01-16T10:00:00Z level=INFO msg=hello`,
		"2024/01/16 10:00:00 message",
		"",
	}
	for _, line := range pos {
		if !f.Detect(line) {
			t.Errorf("Klog.Detect(%q) = false, want true", line)
		}
	}
	for _, line := range neg {
		if f.Detect(line) {
			t.Errorf("Klog.Detect(%q) = true, want false", line)
		}
	}
}

func TestKlogParse(t *testing.T) {
	f := logformat.Klog{}
	tests := []struct {
		line    string
		level   string
		message string
	}{
		{"I0116 10:00:00.000000 1234 server.go:42] server started on :8080", "INFO", "server started on :8080"},
		{"W0116 10:00:00.000000 1234 server.go:42] connection timeout", "WARN", "connection timeout"},
		{"E0116 10:00:00.000000 1234 server.go:42] failed to connect: timeout", "ERROR", "failed to connect: timeout"},
		{"F0116 10:00:00.000000 1234 server.go:42] out of memory", "FATAL", "out of memory"},
	}
	for _, tt := range tests {
		p := f.Parse(tt.line)
		if p.Level != tt.level {
			t.Errorf("Klog.Parse level: got %q, want %q (line=%q)", p.Level, tt.level, tt.line)
		}
		if p.Message != tt.message {
			t.Errorf("Klog.Parse message: got %q, want %q (line=%q)", p.Message, tt.message, tt.line)
		}
		if p.Raw != tt.line {
			t.Errorf("Klog.Parse raw: got %q, want %q", p.Raw, tt.line)
		}
	}
}

// ---- SlogText -----------------------------------------------------------

func TestSlogTextDetect(t *testing.T) {
	f := logformat.SlogText{}
	pos := []string{
		`time=2024-01-16T10:00:00Z level=INFO msg="hello"`,
		`time=2024-01-16T10:00:00Z level=WARN msg=warning key=val`,
	}
	neg := []string{
		"I0116 10:00:00.000000 1234 server.go:42] msg",
		`{"time":"2024-01-16T10:00:00Z","level":"INFO","msg":"hello"}`,
		"2024/01/16 10:00:00 message",
		"INFO plain log line",
		"",
	}
	for _, line := range pos {
		if !f.Detect(line) {
			t.Errorf("SlogText.Detect(%q) = false, want true", line)
		}
	}
	for _, line := range neg {
		if f.Detect(line) {
			t.Errorf("SlogText.Detect(%q) = true, want false", line)
		}
	}
}

func TestSlogTextParse(t *testing.T) {
	f := logformat.SlogText{}
	tests := []struct {
		line    string
		level   string
		message string
	}{
		{`time=2024-01-16T10:00:00Z level=INFO msg="server started"`, "INFO", "server started"},
		{`time=2024-01-16T10:00:00Z level=WARN msg=timeout key=val`, "WARN", "timeout"},
		{`time=2024-01-16T10:00:00Z level=ERROR msg="connection refused" addr=:8080`, "ERROR", "connection refused"},
		{`time=2024-01-16T10:00:00Z level=DEBUG msg="cache miss"`, "DEBUG", "cache miss"},
		// slog level+offset notation
		{`time=2024-01-16T10:00:00Z level=INFO+1 msg=verbose`, "INFO", "verbose"},
	}
	for _, tt := range tests {
		p := f.Parse(tt.line)
		if p.Level != tt.level {
			t.Errorf("SlogText.Parse level: got %q, want %q (line=%q)", p.Level, tt.level, tt.line)
		}
		if p.Message != tt.message {
			t.Errorf("SlogText.Parse message: got %q, want %q (line=%q)", p.Message, tt.message, tt.line)
		}
		if p.Timestamp.IsZero() {
			t.Errorf("SlogText.Parse timestamp should not be zero (line=%q)", tt.line)
		}
	}
}

func TestSlogTextFields(t *testing.T) {
	f := logformat.SlogText{}
	p := f.Parse(`time=2024-01-16T10:00:00Z level=INFO msg="hello" port=8080 host=localhost`)
	if p.Fields["port"] != "8080" {
		t.Errorf("Fields[port] = %q, want %q", p.Fields["port"], "8080")
	}
	if p.Fields["host"] != "localhost" {
		t.Errorf("Fields[host] = %q, want %q", p.Fields["host"], "localhost")
	}
	if _, ok := p.Fields["time"]; ok {
		t.Error("Fields should not contain 'time'")
	}
	if _, ok := p.Fields["level"]; ok {
		t.Error("Fields should not contain 'level'")
	}
	if _, ok := p.Fields["msg"]; ok {
		t.Error("Fields should not contain 'msg'")
	}
}

func TestSlogTextTimestamp(t *testing.T) {
	f := logformat.SlogText{}
	p := f.Parse(`time=2024-01-16T10:30:00Z level=INFO msg="hello"`)
	want := "2024-01-16T10:30:00Z"
	if got := p.Timestamp.UTC().Format("2006-01-02T15:04:05Z"); got != want {
		t.Errorf("SlogText.Parse timestamp: got %q, want %q", got, want)
	}
}

// ---- SlogJSON -----------------------------------------------------------

func TestSlogJSONDetect(t *testing.T) {
	f := logformat.SlogJSON{}
	pos := []string{
		`{"time":"2024-01-16T10:00:00Z","level":"INFO","msg":"hello"}`,
		`{"time":"2024-01-16T10:00:00Z","level":"WARN","msg":"warn","key":"val"}`,
	}
	neg := []string{
		"I0116 10:00:00.000000 1234 server.go:42] msg",
		`time=2024-01-16T10:00:00Z level=INFO msg=hello`,
		"2024/01/16 10:00:00 message",
		`{"no":"level"}`,
		"",
	}
	for _, line := range pos {
		if !f.Detect(line) {
			t.Errorf("SlogJSON.Detect(%q) = false, want true", line)
		}
	}
	for _, line := range neg {
		if f.Detect(line) {
			t.Errorf("SlogJSON.Detect(%q) = true, want false", line)
		}
	}
}

func TestSlogJSONParse(t *testing.T) {
	f := logformat.SlogJSON{}
	tests := []struct {
		line    string
		level   string
		message string
	}{
		{`{"time":"2024-01-16T10:00:00Z","level":"INFO","msg":"server started"}`, "INFO", "server started"},
		{`{"time":"2024-01-16T10:00:00Z","level":"WARN","msg":"timeout"}`, "WARN", "timeout"},
		{`{"time":"2024-01-16T10:00:00Z","level":"ERROR","msg":"connection refused"}`, "ERROR", "connection refused"},
		{`{"time":"2024-01-16T10:00:00Z","level":"DEBUG","msg":"cache miss"}`, "DEBUG", "cache miss"},
	}
	for _, tt := range tests {
		p := f.Parse(tt.line)
		if p.Level != tt.level {
			t.Errorf("SlogJSON.Parse level: got %q, want %q (line=%q)", p.Level, tt.level, tt.line)
		}
		if p.Message != tt.message {
			t.Errorf("SlogJSON.Parse message: got %q, want %q (line=%q)", p.Message, tt.message, tt.line)
		}
		if p.Timestamp.IsZero() {
			t.Errorf("SlogJSON.Parse timestamp should not be zero (line=%q)", tt.line)
		}
	}
}

func TestSlogJSONFields(t *testing.T) {
	f := logformat.SlogJSON{}
	p := f.Parse(`{"time":"2024-01-16T10:00:00Z","level":"INFO","msg":"hello","port":"8080","host":"localhost"}`)
	if p.Fields["port"] != "8080" {
		t.Errorf("Fields[port] = %q, want %q", p.Fields["port"], "8080")
	}
	if p.Fields["host"] != "localhost" {
		t.Errorf("Fields[host] = %q, want %q", p.Fields["host"], "localhost")
	}
	for _, key := range []string{"time", "level", "msg", "source"} {
		if _, ok := p.Fields[key]; ok {
			t.Errorf("Fields should not contain %q", key)
		}
	}
}

func TestKlogTimestamp(t *testing.T) {
	// klog format encodes month/day but not year, so timestamp is not parsed.
	f := logformat.Klog{}
	p := f.Parse("I0116 10:00:00.000000 1234 server.go:42] started")
	if !p.Timestamp.IsZero() {
		t.Errorf("Klog.Parse timestamp: got %v, want zero", p.Timestamp)
	}
}

// ---- StdLog -------------------------------------------------------------

func TestStdLogDetect(t *testing.T) {
	f := logformat.StdLog{}
	pos := []string{
		"2009/11/10 23:00:00 message",
		"2024/01/16 10:00:00.000000 message",
	}
	neg := []string{
		"I0116 10:00:00.000000 1234 server.go:42] msg",
		`{"level":"INFO","msg":"hello"}`,
		`time=2024-01-16T10:00:00Z level=INFO msg=hello`,
		"INFO plain log line",
		"",
	}
	for _, line := range pos {
		if !f.Detect(line) {
			t.Errorf("StdLog.Detect(%q) = false, want true", line)
		}
	}
	for _, line := range neg {
		if f.Detect(line) {
			t.Errorf("StdLog.Detect(%q) = true, want false", line)
		}
	}
}

func TestStdLogParse(t *testing.T) {
	f := logformat.StdLog{}
	tests := []struct {
		line    string
		level   string
		message string
	}{
		{"2009/11/10 23:00:00 INFO server started", "INFO", "INFO server started"},
		{"2009/11/10 23:00:00 ERROR connection failed", "ERROR", "ERROR connection failed"},
		{"2024/01/16 10:00:00.000000 WARN disk usage high", "WARN", "WARN disk usage high"},
		{"2024/01/16 10:00:00 plain message without level", "OTHER", "plain message without level"},
	}
	for _, tt := range tests {
		p := f.Parse(tt.line)
		if p.Level != tt.level {
			t.Errorf("StdLog.Parse level: got %q, want %q (line=%q)", p.Level, tt.level, tt.line)
		}
		if p.Message != tt.message {
			t.Errorf("StdLog.Parse message: got %q, want %q (line=%q)", p.Message, tt.message, tt.line)
		}
		if p.Timestamp.IsZero() {
			t.Errorf("StdLog.Parse timestamp should not be zero (line=%q)", tt.line)
		}
	}
}

// ---- Unstructured -------------------------------------------------------

func TestUnstructuredParse(t *testing.T) {
	tests := []struct {
		line  string
		level string
	}{
		{"INFO server started", "INFO"},
		{"ERROR connection failed", "ERROR"},
		{"WARN disk usage high", "WARN"},
		{"DEBUG cache miss", "DEBUG"},
		{"plain message without level", "OTHER"},
		{"", "OTHER"},
	}
	for _, tt := range tests {
		// unstructured is the Detector's fallback; access it via Detector before format locks in.
		d := &logformat.Detector{}
		p := d.Parse(tt.line)
		if p.Level != tt.level {
			t.Errorf("unstructured.Parse level: got %q, want %q (line=%q)", p.Level, tt.level, tt.line)
		}
		if p.Message != tt.line {
			t.Errorf("unstructured.Parse message: got %q, want %q", p.Message, tt.line)
		}
		if p.Raw != tt.line {
			t.Errorf("unstructured.Parse raw: got %q, want %q", p.Raw, tt.line)
		}
		if !p.Timestamp.IsZero() {
			t.Errorf("unstructured.Parse timestamp: got %v, want zero", p.Timestamp)
		}
	}
}

// ---- Detector -----------------------------------------------------------

func repeat(n int, line string) []string {
	lines := make([]string, n)
	for i := range lines {
		lines[i] = line
	}
	return lines
}

func TestDetectorAutoDetection(t *testing.T) {
	tests := []struct {
		name       string
		lines      []string
		wantFormat string
	}{
		{
			name:       "klog",
			lines:      repeat(10, "I0116 10:00:00.000000 1234 server.go:42] message"),
			wantFormat: "klog",
		},
		{
			name:       "slog-text",
			lines:      repeat(10, `time=2024-01-16T10:00:00Z level=INFO msg="hello"`),
			wantFormat: "slog-text",
		},
		{
			name:       "slog-json",
			lines:      repeat(10, `{"time":"2024-01-16T10:00:00Z","level":"INFO","msg":"hello"}`),
			wantFormat: "slog-json",
		},
		{
			name:       "stdlog",
			lines:      repeat(10, "2024/01/16 10:00:00 message"),
			wantFormat: "stdlog",
		},
		{
			name:       "unstructured",
			lines:      repeat(10, "just some plain log text without any format"),
			wantFormat: "unstructured",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			d := &logformat.Detector{}
			for _, line := range tt.lines {
				d.Parse(line)
			}
			if got := d.FormatName(); got != tt.wantFormat {
				t.Errorf("FormatName() = %q, want %q", got, tt.wantFormat)
			}
		})
	}
}

func TestDetectorSamplingPeriod(t *testing.T) {
	// Lines fed before format locks in (< sampleSize=10) are parsed as unstructured.
	d := &logformat.Detector{}
	line := `time=2024-01-16T10:00:00Z level=INFO msg="hello"`
	p := d.Parse(line)
	// During sampling, level comes from extractLevelFromMessage, not slog-text parser.
	if p.Raw != line {
		t.Errorf("sampling period: Raw = %q, want %q", p.Raw, line)
	}
	if d.FormatName() != "unstructured" {
		t.Errorf("FormatName during sampling = %q, want %q", d.FormatName(), "unstructured")
	}
}

func TestDetectorNoMajority(t *testing.T) {
	// When the best-matching format covers fewer than half the sample lines,
	// the detector falls back to unstructured. 4 klog lines out of 10 = 40% < 50%.
	d := &logformat.Detector{}
	klogLine := "I0116 10:00:00.000000 1234 server.go:42] message"
	plainLine := "just a plain log line"
	for i := 0; i < 4; i++ {
		d.Parse(klogLine)
	}
	for i := 0; i < 6; i++ {
		d.Parse(plainLine)
	}
	if got := d.FormatName(); got != "unstructured" {
		t.Errorf("FormatName with no majority = %q, want %q", got, "unstructured")
	}
}

func TestDetectorParsesCorrectly(t *testing.T) {
	d := &logformat.Detector{}
	// Feed enough klog lines to lock in the format.
	for _, line := range repeat(10, "I0116 10:00:00.000000 1234 server.go:42] startup") {
		d.Parse(line)
	}
	p := d.Parse("E0116 10:00:01.000000 1234 server.go:99] connection dropped")
	if p.Level != "ERROR" {
		t.Errorf("level = %q, want ERROR", p.Level)
	}
	if !strings.Contains(p.Message, "connection dropped") {
		t.Errorf("message %q does not contain 'connection dropped'", p.Message)
	}
}
