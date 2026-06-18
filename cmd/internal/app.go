package internal

import (
	"context"
	"flag"
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

		var k8sClient kubernetes.Interface
		for _, g := range cfg {
			if g.K8s != nil {
				loadingRules := clientcmd.NewDefaultClientConfigLoadingRules()
				kubeConfig := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(
					loadingRules,
					&clientcmd.ConfigOverrides{},
				)
				restConfig, err := kubeConfig.ClientConfig()
				if err != nil {
					log.Fatalf("building kube config: %v", err)
				}
				k8sClient, err = kubernetes.NewForConfig(restConfig)
				if err != nil {
					log.Fatalf("building kube client: %v", err)
				}
				break
			}
		}

		streamerMgr = streamer.NewManager(k8sClient, store, h)
		watcherMgr := watcher.NewManager(k8sClient, cfg)

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
