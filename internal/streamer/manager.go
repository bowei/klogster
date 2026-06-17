package streamer

import (
	"context"
	"log"
	"strings"
	"sync"
	"time"

	"k8s.io/client-go/kubernetes"

	"github.com/bowei/klogster/internal/hub"
	"github.com/bowei/klogster/internal/storage"
	"github.com/bowei/klogster/internal/watcher"
)

type PodInfo struct {
	Namespace     string
	PodName       string
	ContainerName string
}

type Manager struct {
	client kubernetes.Interface
	store  *storage.Store
	hub    *hub.Hub
	stats  *Stats

	mu     sync.Mutex
	active map[string]context.CancelFunc
}

func NewManager(client kubernetes.Interface, store *storage.Store, h *hub.Hub) *Manager {
	return &Manager{
		client: client,
		store:  store,
		hub:    h,
		stats:  newStats(),
		active: make(map[string]context.CancelFunc),
	}
}

func streamerKey(group, ns, pod, container string) string {
	return group + "/" + ns + "/" + pod + "/" + container
}

func (m *Manager) Run(ctx context.Context, events <-chan watcher.PodEvent) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			log.Printf("log stats (per level): %s", m.stats.report())
		case ev, ok := <-events:
			if !ok {
				return
			}
			switch ev.Type {
			case watcher.Added:
				m.startStreamer(ctx, ev)
			case watcher.Deleted:
				m.stopStreamer(ev)
			}
		}
	}
}

func (m *Manager) startStreamer(ctx context.Context, ev watcher.PodEvent) {
	k := streamerKey(ev.GroupName, ev.Namespace, ev.PodName, ev.ContainerName)
	m.mu.Lock()
	if _, exists := m.active[k]; exists {
		m.mu.Unlock()
		return
	}
	sCtx, cancel := context.WithCancel(ctx)
	m.active[k] = cancel
	m.mu.Unlock()

	s := New(ev.GroupName, ev.Namespace, ev.PodName, ev.ContainerName, m.client, m.store, m.hub, m.stats)
	go func() {
		backoff := time.Second
		for {
			err := s.Run(sCtx)
			if sCtx.Err() != nil {
				break
			}
			if err != nil {
				log.Printf("streamer %s: %v (retrying in %v)", k, err, backoff)
				select {
				case <-time.After(backoff):
					if backoff < 30*time.Second {
						backoff *= 2
					}
				case <-sCtx.Done():
					return
				}
			}
		}
		m.mu.Lock()
		delete(m.active, k)
		m.mu.Unlock()
	}()
}

func (m *Manager) stopStreamer(ev watcher.PodEvent) {
	k := streamerKey(ev.GroupName, ev.Namespace, ev.PodName, ev.ContainerName)
	m.mu.Lock()
	defer m.mu.Unlock()
	if cancel, ok := m.active[k]; ok {
		cancel()
		delete(m.active, k)
	}
}

// RegisterDemoPod injects a fake pod/container into the active set without a real streamer.
func (m *Manager) RegisterDemoPod(group, ns, pod, container string) {
	k := streamerKey(group, ns, pod, container)
	m.mu.Lock()
	defer m.mu.Unlock()
	m.active[k] = func() {}
}

// ActivePods returns the currently streaming pods grouped by log group name.
func (m *Manager) ActivePods() map[string][]PodInfo {
	m.mu.Lock()
	defer m.mu.Unlock()
	result := map[string][]PodInfo{}
	for k := range m.active {
		parts := strings.SplitN(k, "/", 4)
		if len(parts) != 4 {
			continue
		}
		group, ns, pod, container := parts[0], parts[1], parts[2], parts[3]
		result[group] = append(result[group], PodInfo{Namespace: ns, PodName: pod, ContainerName: container})
	}
	return result
}
