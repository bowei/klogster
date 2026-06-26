package streamer

import (
	"context"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/bowei/klogster/internal/hub"
	"github.com/bowei/klogster/internal/storage"
)

// fakeLogOpener implements logOpener and returns a fixed stream of log lines.
type fakeLogOpener struct {
	lines []string
}

func (f *fakeLogOpener) open(_ context.Context) (io.ReadCloser, error) {
	return io.NopCloser(strings.NewReader(strings.Join(f.lines, "\n") + "\n")), nil
}

func TestPodStreamer_EndToEnd(t *testing.T) {
	dir := t.TempDir()
	store, err := storage.New(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	h := hub.New()
	client := h.NewClient()
	client.Subscribe("grp", "ns", "pod", "app")
	defer h.RemoveClient(client)

	ts := time.Now().UTC().Format(time.RFC3339)
	inputLines := []string{
		ts + " INFO  server started",
		ts + " ERROR failed to connect",
		ts + " DEBUG cache miss",
	}

	ps := &PodStreamer{
		groupName:     "grp",
		namespace:     "ns",
		podName:       "pod",
		containerName: "app",
		opener:        &fakeLogOpener{lines: inputLines},
		store:         store,
		hub:           h,
		stats:         newStats(),
	}

	if err := ps.Run(context.Background()); err != nil {
		t.Fatalf("Run: %v", err)
	}

	// Storage must contain all lines in order.
	got := store.Tail("grp", "ns", "pod", "app", 10)
	if len(got) != len(inputLines) {
		t.Fatalf("storage: got %d lines, want %d", len(got), len(inputLines))
	}
	for i, want := range inputLines {
		if got[i] != want {
			t.Errorf("storage line %d: got %q, want %q", i, got[i], want)
		}
	}

	// Hub must have broadcast all lines to the subscribed client.
	var received []hub.LogLine
	deadline := time.After(2 * time.Second)
	for len(received) < len(inputLines) {
		select {
		case line, ok := <-client.Send():
			if !ok {
				t.Fatal("hub client channel closed unexpectedly")
			}
			received = append(received, line)
		case <-deadline:
			t.Fatalf("hub: timeout — got %d lines, want %d", len(received), len(inputLines))
		}
	}
	for i, line := range received {
		if line.GroupName != "grp" || line.PodName != "pod" || line.ContainerName != "app" {
			t.Errorf("line %d metadata wrong: %+v", i, line)
		}
	}

	// Stats must reflect the three distinct levels.
	report := ps.stats.report()
	for _, want := range []string{"INFO=1", "ERROR=1", "DEBUG=1"} {
		if !strings.Contains(report, want) {
			t.Errorf("stats report %q missing %s", report, want)
		}
	}
}

// TestPodStreamer_SamplingWindowParsedCorrectly verifies that lines arriving
// during the format-detection sampling window (before sampleSize lines have
// been seen) are emitted with the correct parsed level, not as "OTHER".
func TestPodStreamer_SamplingWindowParsedCorrectly(t *testing.T) {
	dir := t.TempDir()
	store, err := storage.New(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	h := hub.New()
	client := h.NewClient()
	client.Subscribe("grp", "ns", "pod", "app")
	defer h.RemoveClient(client)

	// 11 stdlog lines: the first 9 fall inside the 10-line sampling window.
	var lines []string
	for i := 0; i < 11; i++ {
		lines = append(lines, "2024/01/01 00:00:00 INFO message")
	}

	ps := &PodStreamer{
		groupName:     "grp",
		namespace:     "ns",
		podName:       "pod",
		containerName: "app",
		opener:        &fakeLogOpener{lines: lines},
		store:         store,
		hub:           h,
		stats:         newStats(),
	}

	if err := ps.Run(context.Background()); err != nil {
		t.Fatalf("Run: %v", err)
	}

	var received []hub.LogLine
	deadline := time.After(2 * time.Second)
	for len(received) < len(lines) {
		select {
		case line, ok := <-client.Send():
			if !ok {
				t.Fatal("hub client channel closed unexpectedly")
			}
			received = append(received, line)
		case <-deadline:
			t.Fatalf("hub: timeout — got %d lines, want %d", len(received), len(lines))
		}
	}

	for i, line := range received {
		if line.Level != "INFO" {
			t.Errorf("line %d: Level = %q, want INFO (sampling window lines should be re-parsed after lock-in)", i, line.Level)
		}
	}
}
