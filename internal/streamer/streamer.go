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

// logOpener abstracts opening a pod log stream. The real implementation calls
// the Kubernetes API; tests substitute a fake reader.
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

func New(groupName, namespace, podName, containerName string, client kubernetes.Interface, store *storage.Store, h *hub.Hub, stats *Stats) *PodStreamer {
	return &PodStreamer{
		groupName:     groupName,
		namespace:     namespace,
		podName:       podName,
		containerName: containerName,
		opener: &k8sLogOpener{
			client:        client,
			namespace:     namespace,
			podName:       podName,
			containerName: containerName,
		},
		store: store,
		hub:   h,
		stats: stats,
	}
}

func (s *PodStreamer) Run(ctx context.Context) error {
	stream, err := s.opener.open(ctx)
	if err != nil {
		return err
	}
	defer stream.Close()

	detector := &logformat.Detector{}
	scanner := bufio.NewScanner(stream)
	for scanner.Scan() {
		if ctx.Err() != nil {
			break
		}
		line := scanner.Text()
		ts, inner := splitK8sLine(line)
		parsed := detector.Parse(inner)
		s.stats.add(parsed.Level)
		s.store.Append(s.groupName, s.namespace, s.podName, s.containerName, line)
		s.hub.Broadcast(hub.LogLine{
			GroupName:     s.groupName,
			Namespace:     s.namespace,
			PodName:       s.podName,
			ContainerName: s.containerName,
			Timestamp:     ts,
			Level:         parsed.Level,
			Text:          line,
		})
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
