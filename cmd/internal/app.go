package internal

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"

	"github.com/bowei/klogster/internal/api"
	"github.com/bowei/klogster/internal/config"
	"github.com/bowei/klogster/internal/demo"
	"github.com/bowei/klogster/internal/hub"
	"github.com/bowei/klogster/internal/storage"
	"github.com/bowei/klogster/internal/streamer"
	"github.com/bowei/klogster/internal/watcher"
)

func Run() {
	logdir := flag.String("logdir", "/tmp/klogster", "directory to store logs")
	cfgFile := flag.String("cfg", "klogster.yaml", "config file")
	serve := flag.String("serve", ":7070", "address to serve the UI")
	demof := flag.Bool("demo", false, "run with sample data instead of connecting to Kubernetes")
	flag.Parse()

	store, err := storage.New(*logdir)
	if err != nil {
		log.Fatalf("creating store: %v", err)
	}
	defer store.Close()

	h := hub.New()

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	var streamerMgr *streamer.Manager

	if *demof {
		streamerMgr = streamer.NewManager(nil, store, h)
		demo.SeedDemoData(store, streamerMgr)
	} else {
		cfg, err := config.Load(*cfgFile)
		if err != nil {
			log.Fatalf("loading config: %v", err)
		}

		k8sClients, err := buildK8sClients(cfg)
		if err != nil {
			log.Fatalf("building kube clients: %v", err)
		}

		streamerMgr = streamer.NewManager(k8sClients, store, h)
		watcherMgr := watcher.NewManager(k8sClients, cfg)

		go watcherMgr.Run(ctx)
		go streamerMgr.Run(ctx, watcherMgr.Events())
	}

	srv := api.New(store, h, streamerMgr)
	httpServer := &http.Server{
		Addr:    *serve,
		Handler: srv.Handler(),
	}

	go func() {
		<-ctx.Done()
		httpServer.Shutdown(context.Background()) //nolint:errcheck
	}()

	log.Printf("klogster UI at http://%s", *serve)
	if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("http server: %v", err)
	}
}

func buildK8sClients(cfg config.Config) (map[string]kubernetes.Interface, error) {
	clients := map[string]kubernetes.Interface{}
	loadingRules := clientcmd.NewDefaultClientConfigLoadingRules()
	for _, g := range cfg {
		if g.K8s == nil {
			continue
		}
		ctx := g.K8s.ClusterContext
		if _, ok := clients[ctx]; ok {
			continue
		}
		overrides := &clientcmd.ConfigOverrides{}
		if ctx != "" {
			overrides.CurrentContext = ctx
		}
		restConfig, err := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(loadingRules, overrides).ClientConfig()
		if err != nil {
			return nil, fmt.Errorf("building kube config for context %q: %w", ctx, err)
		}
		client, err := kubernetes.NewForConfig(restConfig)
		if err != nil {
			return nil, fmt.Errorf("building kube client for context %q: %w", ctx, err)
		}
		clients[ctx] = client
	}
	return clients, nil
}
