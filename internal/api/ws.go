package api

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type wsMessage struct {
	Type  string `json:"type"`
	Group string `json:"group"`
	NS    string `json:"ns"`
	Pod   string `json:"pod"`
}

func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("ws upgrade: %v", err)
		return
	}
	defer conn.Close()

	client := s.hub.NewClient()
	defer s.hub.RemoveClient(client)

	writeDone := make(chan struct{})
	go func() {
		defer close(writeDone)
		for line := range client.Send() {
			if err := conn.WriteJSON(line); err != nil {
				return
			}
		}
	}()

	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			break
		}
		var m wsMessage
		if err := json.Unmarshal(msg, &m); err != nil {
			continue
		}
		switch m.Type {
		case "subscribe":
			client.Subscribe(m.Group, m.NS, m.Pod)
		case "unsubscribe":
			client.Unsubscribe(m.Group, m.NS, m.Pod)
		}
	}
	<-writeDone
}
