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

