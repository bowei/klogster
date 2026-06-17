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
	"time"

	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"

	"github.com/bowei/klogster/internal/api"
	"github.com/bowei/klogster/internal/config"
	"github.com/bowei/klogster/internal/hub"
	"github.com/bowei/klogster/internal/storage"
	"github.com/bowei/klogster/internal/streamer"
	"github.com/bowei/klogster/internal/watcher"
)

func Run() {
	logdir := flag.String("logdir", "/tmp/klogster", "directory to store logs")
	cfgFile := flag.String("cfg", "klogster.yaml", "config file")
	serve := flag.String("serve", ":7070", "address to serve the UI")
	demo := flag.Bool("demo", false, "run with sample data instead of connecting to Kubernetes")
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

	if *demo {
		streamerMgr = streamer.NewManager(nil, store, h)
		seedDemoData(store, streamerMgr)
	} else {
		cfg, err := config.Load(*cfgFile)
		if err != nil {
			log.Fatalf("loading config: %v", err)
		}

		loadingRules := clientcmd.NewDefaultClientConfigLoadingRules()
		kubeConfig := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(
			loadingRules,
			&clientcmd.ConfigOverrides{},
		)
		restConfig, err := kubeConfig.ClientConfig()
		if err != nil {
			log.Fatalf("building kube config: %v", err)
		}
		k8sClient, err := kubernetes.NewForConfig(restConfig)
		if err != nil {
			log.Fatalf("building kube client: %v", err)
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

type demoPod struct {
	group string
	ns    string
	pod   string
}

func seedDemoData(store *storage.Store, mgr *streamer.Manager) {
	pods := []demoPod{
		{"serverPods", "server-ns", "server-6d4f8b9c7-xkqzp"},
		{"serverPods", "server-ns", "server-6d4f8b9c7-mnjvw"},
		{"serverPods", "server-ns", "server-6d4f8b9c7-rthbs"},
		{"databasePods", "db-ns", "mysql-0"},
		{"databasePods", "backup-db-ns", "postgres-7c9d6f-lmnop"},
	}

	for _, p := range pods {
		mgr.RegisterDemoPod(p.group, p.ns, p.pod)
		seedPodLogs(store, p)
	}
}

var demoLevels = []string{"INFO", "WARN", "ERROR", "DEBUG"}

func seedPodLogs(store *storage.Store, p demoPod) {
	base := time.Now().Add(-10 * time.Minute)

	templates := demoLogTemplates(p)
	for i, tmpl := range templates {
		ts := base.Add(time.Duration(i) * 3 * time.Second).Format(time.RFC3339)
		line := fmt.Sprintf("%s  %s", ts, tmpl)
		store.Append(p.group, p.ns, p.pod, line)
	}
}

func demoLogTemplates(p demoPod) []string {
	switch p.group {
	case "serverPods":
		return []string{
			`INFO  Starting HTTP server on :8080`,
			`INFO  Connected to database at db-ns/mysql-0:3306`,
			`DEBUG Loaded 42 feature flags from config`,
			`INFO  GET /api/v1/users 200 14ms`,
			`INFO  GET /api/v1/health 200 1ms`,
			`INFO  POST /api/v1/orders 201 38ms`,
			`DEBUG Cache hit ratio: 0.87`,
			`INFO  GET /api/v1/users/1042 200 9ms`,
			`WARN  Rate limit approaching for client 10.0.0.15: 480/500 req/min`,
			`INFO  GET /api/v1/products 200 22ms`,
			`INFO  DELETE /api/v1/sessions/tok_abc123 204 5ms`,
			`DEBUG Flushing metrics batch (n=128)`,
			`INFO  GET /api/v1/orders?page=2 200 17ms`,
			`ERROR Failed to reach upstream payment service: dial tcp 10.1.2.3:443: i/o timeout`,
			`WARN  Retrying payment service (attempt 1/3)`,
			`WARN  Retrying payment service (attempt 2/3)`,
			`INFO  Payment service recovered after 2 retries`,
			`INFO  POST /api/v1/checkout 200 1243ms`,
			`INFO  GET /api/v1/health 200 1ms`,
			`DEBUG GC pause 1.2ms`,
		}
	case "databasePods":
		if p.ns == "db-ns" {
			return []string{
				`[Note] InnoDB: innodb_file_per_table=ON`,
				`[Note] mysqld: ready for connections. Version: '8.0.34' socket: '/var/run/mysqld/mysqld.sock' port: 3306`,
				`[Note] InnoDB: Buffer pool(s) load completed at 2024-01-15T10:00:01`,
				`[Note] Got connection id 1042`,
				`[Note] Query_time: 0.002341  Lock_time: 0.000102 Rows_sent: 1 Rows_examined: 1`,
				`[Note] Got connection id 1043`,
				`[Warning] Aborted connection 1041 to db: 'appdb' user: 'appuser' host: '10.0.1.5' (Got an error reading communication packets)`,
				`[Note] Query_time: 0.045182  Lock_time: 0.001234 Rows_sent: 250 Rows_examined: 12483`,
				`[Note] InnoDB: page_cleaner: 1000ms intended loop took 1234ms. The settings might not be optimal.`,
				`[Note] Got connection id 1044`,
				`[Note] Query_time: 0.001002  Lock_time: 0.000088 Rows_sent: 1 Rows_examined: 1`,
				`[Note] Got connection id 1045`,
				`[Warning] IP address '10.0.2.99' could not be resolved: Name or service not known`,
				`[Note] Query_time: 0.000541  Lock_time: 0.000041 Rows_sent: 0 Rows_examined: 0`,
				`[Note] Slow query logged (threshold: 10ms): SELECT * FROM orders WHERE status='pending' ORDER BY created_at DESC LIMIT 100`,
				`[Note] Got connection id 1046`,
			}
		}
		return []string{
			`2024-01-15 10:00:00.123 UTC [1] LOG:  database system is ready to accept connections`,
			`2024-01-15 10:00:01.456 UTC [42] LOG:  checkpoint starting: time`,
			`2024-01-15 10:00:05.789 UTC [42] LOG:  checkpoint complete: wrote 128 buffers (0.8%); 0 WAL file(s) added, 0 removed, 1 recycled`,
			`2024-01-15 10:00:10.001 UTC [101] LOG:  connection received: host=10.0.1.8 port=54312`,
			`2024-01-15 10:00:10.002 UTC [101] LOG:  connection authorized: user=replica database=replication`,
			`2024-01-15 10:01:00.100 UTC [42] LOG:  checkpoint starting: time`,
			`2024-01-15 10:01:00.201 UTC [55] LOG:  duration: 12.345 ms  statement: SELECT count(*) FROM events WHERE created_at > now() - interval '1 hour'`,
			`2024-01-15 10:01:05.300 UTC [42] LOG:  checkpoint complete: wrote 64 buffers (0.4%)`,
			`2024-01-15 10:01:30.400 UTC [200] WARNING:  could not serialize access due to concurrent update`,
			`2024-01-15 10:01:30.401 UTC [200] LOG:  statement: UPDATE jobs SET status='running' WHERE id=9981 AND status='pending'`,
			`2024-01-15 10:02:00.500 UTC [42] LOG:  checkpoint starting: time`,
			`2024-01-15 10:02:01.600 UTC [300] LOG:  connection received: host=10.0.1.5 port=61204`,
			`2024-01-15 10:02:01.601 UTC [300] LOG:  connection authorized: user=appuser database=appdb`,
		}
	}
	return []string{"INFO starting"}
}
