package watcher

import (
	"context"
	"fmt"
	"strings"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/cache"
)

type EventType int

const (
	Added EventType = iota
	Deleted
)

type PodEvent struct {
	Type      EventType
	GroupName string
	Namespace string
	PodName   string
}

type PodWatcher struct {
	groupName string
	namespace string
	labels    map[string]string
	client    kubernetes.Interface
	events    chan<- PodEvent
}

func NewPodWatcher(groupName, namespace string, labels map[string]string, client kubernetes.Interface, events chan<- PodEvent) *PodWatcher {
	return &PodWatcher{
		groupName: groupName,
		namespace: namespace,
		labels:    labels,
		client:    client,
		events:    events,
	}
}

func labelSelector(labels map[string]string) string {
	parts := make([]string, 0, len(labels))
	for k, v := range labels {
		parts = append(parts, fmt.Sprintf("%s=%s", k, v))
	}
	return strings.Join(parts, ",")
}

func podFromTombstone(obj interface{}) (*corev1.Pod, bool) {
	pod, ok := obj.(*corev1.Pod)
	if ok {
		return pod, true
	}
	tombstone, ok := obj.(cache.DeletedFinalStateUnknown)
	if !ok {
		return nil, false
	}
	pod, ok = tombstone.Obj.(*corev1.Pod)
	return pod, ok
}

func (w *PodWatcher) Run(ctx context.Context) {
	sel := labelSelector(w.labels)
	factory := informers.NewSharedInformerFactoryWithOptions(
		w.client,
		0,
		informers.WithNamespace(w.namespace),
		informers.WithTweakListOptions(func(opts *metav1.ListOptions) {
			opts.LabelSelector = sel
		}),
	)

	informer := factory.Core().V1().Pods().Informer()
	informer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			pod, ok := obj.(*corev1.Pod)
			if !ok {
				return
			}
			select {
			case w.events <- PodEvent{Type: Added, GroupName: w.groupName, Namespace: w.namespace, PodName: pod.Name}:
			case <-ctx.Done():
			}
		},
		DeleteFunc: func(obj interface{}) {
			pod, ok := podFromTombstone(obj)
			if !ok {
				return
			}
			select {
			case w.events <- PodEvent{Type: Deleted, GroupName: w.groupName, Namespace: w.namespace, PodName: pod.Name}:
			case <-ctx.Done():
			}
		},
	})

	factory.Start(ctx.Done())
	factory.WaitForCacheSync(ctx.Done())
	<-ctx.Done()
}
