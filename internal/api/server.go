package api

import (
	"io/fs"
	"net/http"

	"github.com/bowei/klogster/internal/hub"
	"github.com/bowei/klogster/internal/storage"
	"github.com/bowei/klogster/internal/streamer"
	"github.com/bowei/klogster/web"
)

type Server struct {
	store       *storage.Store
	hub         *hub.Hub
	streamerMgr *streamer.Manager
}

func New(store *storage.Store, h *hub.Hub, mgr *streamer.Manager) *Server {
	return &Server{store: store, hub: h, streamerMgr: mgr}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/groups", s.handleGroups)
	mux.HandleFunc("/api/logs", s.handleLogs)
	mux.HandleFunc("/ws", s.handleWebSocket)

	uiFS, _ := fs.Sub(web.FS, "static")
	mux.Handle("/", http.FileServer(http.FS(uiFS)))
	return mux
}
