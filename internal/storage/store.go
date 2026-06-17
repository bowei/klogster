package storage

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

const ringSize = 10000

type ringBuffer struct {
	lines []string
	head  int
	size  int
}

func newRingBuffer() *ringBuffer {
	return &ringBuffer{lines: make([]string, ringSize)}
}

func (r *ringBuffer) append(line string) {
	r.lines[r.head%ringSize] = line
	r.head++
	if r.size < ringSize {
		r.size++
	}
}

func (r *ringBuffer) tail(n int) []string {
	if n > r.size {
		n = r.size
	}
	result := make([]string, n)
	start := r.head - n
	for i := 0; i < n; i++ {
		result[i] = r.lines[(start+i)%ringSize]
	}
	return result
}

type Store struct {
	logdir  string
	mu      sync.Mutex
	files   map[string]*os.File
	buffers map[string]*ringBuffer
}

func New(logdir string) (*Store, error) {
	if err := os.MkdirAll(logdir, 0755); err != nil {
		return nil, fmt.Errorf("creating log dir: %w", err)
	}
	return &Store{
		logdir:  logdir,
		files:   make(map[string]*os.File),
		buffers: make(map[string]*ringBuffer),
	}, nil
}

func podKey(group, ns, pod, container string) string {
	return group + "/" + ns + "/" + pod + "/" + container
}

func (s *Store) getFile(group, ns, pod, container string) (*os.File, error) {
	key := podKey(group, ns, pod, container)
	if f, ok := s.files[key]; ok {
		return f, nil
	}
	dir := filepath.Join(s.logdir, group)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, err
	}
	path := filepath.Join(dir, ns+":"+pod+":"+container)
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return nil, err
	}
	s.files[key] = f
	return f, nil
}

func (s *Store) getBuffer(group, ns, pod, container string) *ringBuffer {
	key := podKey(group, ns, pod, container)
	if b, ok := s.buffers[key]; ok {
		return b
	}
	b := newRingBuffer()
	s.buffers[key] = b
	return b
}

func (s *Store) Append(group, ns, pod, container, line string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	f, err := s.getFile(group, ns, pod, container)
	if err == nil {
		f.WriteString(line + "\n")
	}
	s.getBuffer(group, ns, pod, container).append(line)
}

func (s *Store) Tail(group, ns, pod, container string, n int) []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.getBuffer(group, ns, pod, container).tail(n)
}

func (s *Store) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, f := range s.files {
		f.Close()
	}
}
