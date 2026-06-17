package watcher

import (
	"context"
	"sync"

	"github.com/bowei/klogster/internal/config"
	"k8s.io/client-go/kubernetes"
)

type Manager struct {
	client kubernetes.Interface
	cfg    config.Config
	events chan PodEvent
}

func NewManager(client kubernetes.Interface, cfg config.Config) *Manager {
	return &Manager{
		client: client,
		cfg:    cfg,
		events: make(chan PodEvent, 64),
	}
}

func (m *Manager) Events() <-chan PodEvent {
	return m.events
}

func (m *Manager) Run(ctx context.Context) {
	var wg sync.WaitGroup
	for _, group := range m.cfg {
		for _, sel := range group.Selectors {
			wg.Add(1)
			w := NewPodWatcher(group.Name, sel.Namespace, sel.Labels, m.client, m.events)
			go func() {
				defer wg.Done()
				w.Run(ctx)
			}()
		}
	}
	wg.Wait()
	close(m.events)
}
