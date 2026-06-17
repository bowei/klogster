package logformat

import (
	"regexp"
	"strings"
)

// Klog parses the klog format used by Kubernetes components:
//
//	I0116 10:00:00.000000 1234 server.go:42] message text
//
// The first character encodes the level: I=INFO, W=WARN, E=ERROR, F=FATAL.

var (
	klogDetectRE = regexp.MustCompile(`^[IWEF]\d{4} \d{2}:\d{2}:\d{2}\.\d+\s+\d+\s+\S+:\d+\]`)
	klogMsgRE    = regexp.MustCompile(`^[IWEF]\d{4} \d{2}:\d{2}:\d{2}\.\d+\s+\d+\s+\S+:\d+\]\s*(.*)$`)
)

func init() { Register(Klog{}) }

// Klog implements Format for the klog library.
type Klog struct{}

func (Klog) Name() string { return "klog" }

func (Klog) Detect(line string) bool { return klogDetectRE.MatchString(line) }

func (Klog) Parse(line string) ParsedLine {
	p := ParsedLine{Raw: line, Level: "OTHER", Message: line}
	if len(line) == 0 {
		return p
	}
	switch line[0] {
	case 'I':
		p.Level = "INFO"
	case 'W':
		p.Level = "WARN"
	case 'E':
		p.Level = "ERROR"
	case 'F':
		p.Level = "FATAL"
	default:
		return p
	}
	if m := klogMsgRE.FindStringSubmatch(line); m != nil {
		p.Message = strings.TrimSpace(m[1])
	}
	return p
}
