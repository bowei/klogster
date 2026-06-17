package streamer

import (
	"fmt"
	"sort"
	"strings"
	"sync"
)

type Stats struct {
	mu     sync.Mutex
	counts map[string]int64
}

func newStats() *Stats {
	return &Stats{counts: make(map[string]int64)}
}

func (s *Stats) add(level string) {
	s.mu.Lock()
	s.counts[level]++
	s.mu.Unlock()
}

func (s *Stats) report() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.counts) == 0 {
		return "no logs pulled yet"
	}
	levels := make([]string, 0, len(s.counts))
	for l := range s.counts {
		levels = append(levels, l)
	}
	sort.Strings(levels)
	parts := make([]string, 0, len(levels))
	for _, l := range levels {
		parts = append(parts, fmt.Sprintf("%s=%d", l, s.counts[l]))
	}
	return strings.Join(parts, " ")
}

// parseLevel extracts a normalized log level from a raw log line.
// Lines from K8s have a leading RFC3339 timestamp token prepended by the API.
func parseLevel(line string) string {
	// skip timestamp prefix
	idx := strings.IndexByte(line, ' ')
	if idx < 0 {
		return "OTHER"
	}
	rest := strings.TrimLeft(line[idx:], " ")
	end := strings.IndexAny(rest, " \t")
	if end < 0 {
		end = len(rest)
	}
	token := strings.ToUpper(strings.Trim(rest[:end], "[]():"))
	switch token {
	case "INFO", "INFORMATION":
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
	case "NOTE", "NOTICE", "LOG":
		return "INFO"
	default:
		return "OTHER"
	}
}
