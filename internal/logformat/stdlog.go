package logformat

import (
	"regexp"
	"strings"
	"time"
)

// StdLog parses Go's standard library log package format:
//
//	2009/11/10 23:00:00 message
//	2009/11/10 23:00:00.000000 message  (with log.Lmicroseconds)
//
// The format carries no level indicator; level is inferred from the message.

var stdlogDetectRE = regexp.MustCompile(`^\d{4}/\d{2}/\d{2} \d{2}:\d{2}:\d{2}`)

func init() { Register(StdLog{}) }

// StdLog implements Format for the Go standard library log package.
type StdLog struct{}

func (StdLog) Name() string { return "stdlog" }

func (StdLog) Detect(line string) bool { return stdlogDetectRE.MatchString(line) }

func (StdLog) Parse(line string) ParsedLine {
	p := ParsedLine{Raw: line, Level: "OTHER", Message: line}
	if len(line) < 19 {
		return p
	}
	// Determine timestamp end: "2006/01/02 15:04:05" (19 chars) or
	// "2006/01/02 15:04:05.000000" (26 chars) when Lmicroseconds is set.
	tsEnd := 19
	if len(line) > 19 && line[19] == '.' {
		if sp := strings.IndexByte(line[20:], ' '); sp >= 0 {
			tsEnd = 20 + sp
		}
	}
	var t time.Time
	var err error
	if tsEnd == 19 {
		t, err = time.Parse("2006/01/02 15:04:05", line[:19])
	} else {
		t, err = time.Parse("2006/01/02 15:04:05.000000", line[:tsEnd])
	}
	if err != nil {
		return p
	}
	p.Timestamp = t
	msg := strings.TrimLeft(line[tsEnd:], " ")
	p.Message = msg
	p.Level = extractLevelFromMessage(msg)
	return p
}
