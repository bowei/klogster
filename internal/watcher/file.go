package watcher

import (
	"context"
	"path/filepath"

	"github.com/bowei/klogster/internal/config"
)

// FileWatcher emits a single Added event for a file log group and then waits
// for the context to be cancelled.
type FileWatcher struct {
	group  config.LogGroup
	events chan<- PodEvent
}

func (w *FileWatcher) Run(ctx context.Context) {
	path := w.group.File.Path
	ev := PodEvent{
		Type:          Added,
		GroupName:     w.group.Name,
		Namespace:     "local",
		PodName:       filepath.Base(path),
		ContainerName: "tail",
		FilePath:      path,
	}
	select {
	case w.events <- ev:
	case <-ctx.Done():
		return
	}
	<-ctx.Done()
}
