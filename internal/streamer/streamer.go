package streamer

import (
	"bufio"
	"context"
	"io"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/client-go/kubernetes"

	"github.com/bowei/klogster/internal/hub"
	"github.com/bowei/klogster/internal/logformat"
	"github.com/bowei/klogster/internal/storage"
)

// logOpener abstracts opening a log stream. The k8s implementation calls the
// Kubernetes API; the file implementation polls a local file.
type logOpener interface {
	open(ctx context.Context) (io.ReadCloser, error)
}

type k8sLogOpener struct {
	client        kubernetes.Interface
	namespace     string
	podName       string
	containerName string
}

func (o *k8sLogOpener) open(ctx context.Context) (io.ReadCloser, error) {
	opts := &corev1.PodLogOptions{
		Follow:     true,
		Timestamps: true,
		Container:  o.containerName,
	}
	return o.client.CoreV1().Pods(o.namespace).GetLogs(o.podName, opts).Stream(ctx)
}

type PodStreamer struct {
	groupName     string
	namespace     string
	podName       string
	containerName string
	opener        logOpener
	store         *storage.Store
	hub           *hub.Hub
	stats         *Stats
}

func newWithOpener(groupName, namespace, podName, containerName string, opener logOpener, store *storage.Store, h *hub.Hub, stats *Stats) *PodStreamer {
	return &PodStreamer{
		groupName:     groupName,
		namespace:     namespace,
		podName:       podName,
		containerName: containerName,
		opener:        opener,
		store:         store,
		hub:           h,
		stats:         stats,
	}
}

func (s *PodStreamer) Run(ctx context.Context) error {
	stream, err := s.opener.open(ctx)
	if err != nil {
		return err
	}
	defer stream.Close()

	type entry struct {
		line  string
		ts    time.Time
		inner string
	}

	detector := &logformat.Detector{}
	var buf []entry

	emit := func(e entry) {
		parsed := detector.Parse(e.inner)
		ts := e.ts
		if ts.IsZero() {
			ts = parsed.Timestamp
		}
		s.stats.add(parsed.Level)
		s.store.Append(s.groupName, s.namespace, s.podName, s.containerName, e.line)
		s.hub.Broadcast(hub.LogLine{
			GroupName:     s.groupName,
			Namespace:     s.namespace,
			PodName:       s.podName,
			ContainerName: s.containerName,
			Timestamp:     ts,
			Level:         parsed.Level,
			Text:          e.line,
			Message:       parsed.Message,
			Fields:        parsed.Fields,
		})
	}

	scanner := bufio.NewScanner(stream)
	for scanner.Scan() {
		if ctx.Err() != nil {
			break
		}
		line := scanner.Text()
		ts, inner := splitK8sLine(line)
		e := entry{line, ts, inner}

		if !detector.IsLocked() {
			// Feed this line to the detector for format detection, then buffer it.
			// We call Parse to advance the sample window; the result is discarded
			// because we'll re-parse once the format is locked in.
			detector.Parse(inner)
			buf = append(buf, e)

			if !detector.IsLocked() {
				continue
			}
			// The detector just locked in on this line. Re-parse and emit all
			// buffered lines (including the current one) with the correct format.
			for _, b := range buf {
				emit(b)
			}
			buf = nil
			continue
		}

		emit(e)
	}

	// Stream ended before sampleSize lines were collected; flush the buffer.
	if len(buf) > 0 {
		detector.Finalize()
		for _, b := range buf {
			emit(b)
		}
	}

	return scanner.Err()
}

// splitK8sLine separates the RFC3339Nano timestamp prepended by the Kubernetes
// log API from the rest of the line. Returns zero time if not present.
func splitK8sLine(line string) (time.Time, string) {
	idx := strings.IndexByte(line, ' ')
	if idx < 0 {
		return time.Time{}, line
	}
	t, err := time.Parse(time.RFC3339Nano, line[:idx])
	if err != nil {
		return time.Time{}, line
	}
	return t, line[idx+1:]
}
