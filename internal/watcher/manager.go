package watcher

import (
	"context"
	"sync"

	"github.com/bowei/klogster/internal/config"
	"k8s.io/client-go/kubernetes"
)

type Manager struct {
	clients map[string]kubernetes.Interface
	cfg     config.Config
	events  chan PodEvent
}

func NewManager(clients map[string]kubernetes.Interface, cfg config.Config) *Manager {
	return &Manager{
		clients: clients,
		cfg:     cfg,
		events:  make(chan PodEvent, 64),
	}
}

func (m *Manager) Events() <-chan PodEvent {
	return m.events
}

func (m *Manager) Run(ctx context.Context) {
	var wg sync.WaitGroup
	for _, group := range m.cfg {
		group := group
		if group.K8s != nil {
			client := m.clients[group.K8s.ClusterContext]
			for _, sel := range group.K8s.Selectors {
				sel := sel
				wg.Add(1)
				w := NewPodWatcher(group.Name, group.K8s.ClusterContext, sel.Namespace, sel.Labels, sel.Containers, client, m.events)
				go func() {
					defer wg.Done()
					w.Run(ctx)
				}()
			}
		} else if group.File != nil {
			wg.Add(1)
			fw := &FileWatcher{group: group, events: m.events}
			go func() {
				defer wg.Done()
				fw.Run(ctx)
			}()
		}
	}
	wg.Wait()
	close(m.events)
}
