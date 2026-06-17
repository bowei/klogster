package api

import (
	"encoding/json"
	"net/http"
	"strconv"
)

type groupsResponse struct {
	Groups []groupInfo `json:"groups"`
}

type groupInfo struct {
	Name string    `json:"name"`
	Pods []podInfo `json:"pods"`
}

type podInfo struct {
	Namespace string `json:"namespace"`
	Pod       string `json:"pod"`
	Container string `json:"container"`
}

func (s *Server) handleGroups(w http.ResponseWriter, r *http.Request) {
	active := s.streamerMgr.ActivePods()
	resp := groupsResponse{}
	for group, pods := range active {
		gi := groupInfo{Name: group}
		for _, p := range pods {
			gi.Pods = append(gi.Pods, podInfo{Namespace: p.Namespace, Pod: p.PodName, Container: p.ContainerName})
		}
		resp.Groups = append(resp.Groups, gi)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func (s *Server) handleLogs(w http.ResponseWriter, r *http.Request) {
	group := r.URL.Query().Get("group")
	ns := r.URL.Query().Get("ns")
	pod := r.URL.Query().Get("pod")
	container := r.URL.Query().Get("container")
	n := 200
	if nStr := r.URL.Query().Get("lines"); nStr != "" {
		if parsed, err := strconv.Atoi(nStr); err == nil && parsed > 0 {
			n = parsed
		}
	}
	lines := s.store.Tail(group, ns, pod, container, n)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(lines)
}
