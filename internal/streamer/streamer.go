package streamer

import (
	"bufio"
	"context"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/client-go/kubernetes"

	"github.com/bowei/klogster/internal/hub"
	"github.com/bowei/klogster/internal/storage"
)

type PodStreamer struct {
	groupName     string
	namespace     string
	podName       string
	containerName string
	client        kubernetes.Interface
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
		client:        client,
		store:         store,
		hub:           h,
		stats:         stats,
	}
}

func (s *PodStreamer) Run(ctx context.Context) error {
	opts := &corev1.PodLogOptions{
		Follow:     true,
		Timestamps: true,
		Container:  s.containerName,
	}
	req := s.client.CoreV1().Pods(s.namespace).GetLogs(s.podName, opts)
	stream, err := req.Stream(ctx)
	if err != nil {
		return err
	}
	defer stream.Close()

	scanner := bufio.NewScanner(stream)
	for scanner.Scan() {
		if ctx.Err() != nil {
			break
		}
		line := scanner.Text()
		ts := parseTimestamp(line)
		s.stats.add(parseLevel(line))
		s.store.Append(s.groupName, s.namespace, s.podName, s.containerName, line)
		s.hub.Broadcast(hub.LogLine{
			GroupName:     s.groupName,
			Namespace:     s.namespace,
			PodName:       s.podName,
			ContainerName: s.containerName,
			Timestamp:     ts,
			Text:          line,
		})
	}
	return scanner.Err()
}

func parseTimestamp(line string) time.Time {
	idx := strings.IndexByte(line, ' ')
	if idx < 0 {
		return time.Time{}
	}
	t, err := time.Parse(time.RFC3339Nano, line[:idx])
	if err != nil {
		return time.Time{}
	}
	return t
}
