package hub

import (
	"sync"
	"time"
)

type LogLine struct {
	GroupName     string            `json:"group"`
	Namespace     string            `json:"ns"`
	PodName       string            `json:"pod"`
	ContainerName string            `json:"container"`
	Timestamp     time.Time         `json:"ts"`
	Level         string            `json:"level"`
	Text          string            `json:"text"`
	Message       string            `json:"message"`
	Fields        map[string]string `json:"fields,omitempty"`
}

type Client struct {
	send          chan LogLine
	subscriptions map[string]bool
	mu            sync.Mutex
	closed        bool
}

func (c *Client) Subscribe(group, ns, pod, container string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.subscriptions[subKey(group, ns, pod, container)] = true
}

func (c *Client) Unsubscribe(group, ns, pod, container string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.subscriptions, subKey(group, ns, pod, container))
}

func (c *Client) isSubscribed(group, ns, pod, container string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.subscriptions[subKey(group, ns, pod, container)]
}

func (c *Client) Send() <-chan LogLine {
	return c.send
}

func subKey(group, ns, pod, container string) string {
	return group + "/" + ns + "/" + pod + "/" + container
}

type Hub struct {
	mu      sync.RWMutex
	clients map[*Client]bool
}

func New() *Hub {
	return &Hub{clients: make(map[*Client]bool)}
}

func (h *Hub) NewClient() *Client {
	c := &Client{
		send:          make(chan LogLine, 256),
		subscriptions: make(map[string]bool),
	}
	h.mu.Lock()
	h.clients[c] = true
	h.mu.Unlock()
	return c
}

// RemoveClient removes the client from the hub and closes its send channel.
// Safe to call from any goroutine. After this returns, no more lines will be
// delivered to the client.
func (h *Hub) RemoveClient(c *Client) {
	h.mu.Lock()
	delete(h.clients, c)
	h.mu.Unlock()

	// Set closed under c.mu so Broadcast cannot send after close.
	c.mu.Lock()
	c.closed = true
	close(c.send)
	c.mu.Unlock()
}

func (h *Hub) Broadcast(line LogLine) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.clients {
		if !c.isSubscribed(line.GroupName, line.Namespace, line.PodName, line.ContainerName) {
			continue
		}
		c.mu.Lock()
		if !c.closed {
			select {
			case c.send <- line:
			default:
			}
		}
		c.mu.Unlock()
	}
}
