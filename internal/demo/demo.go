package demo

import (
	"fmt"
	"time"

	"github.com/bowei/klogster/internal/storage"
	"github.com/bowei/klogster/internal/streamer"
)

type demoPod struct {
	group     string
	ns        string
	pod       string
	container string
	variant   int
}

func SeedDemoData(store *storage.Store, mgr *streamer.Manager) {
	pods := []demoPod{
		{"serverPods", "server-ns", "server-6d4f8b9c7-xkqzp", "app", 0},
		{"serverPods", "server-ns", "server-6d4f8b9c7-mnjvw", "app", 1},
		{"serverPods", "server-ns", "server-6d4f8b9c7-rthbs", "app", 2},
		{"workerPods", "worker-ns", "worker-7f8b9c-abcde", "worker", 0},
		{"workerPods", "worker-ns", "worker-7f8b9c-fghij", "worker", 1},
		{"databasePods", "db-ns", "mysql-0", "mysql", 0},
		{"databasePods", "db-ns", "postgres-7c9d6f-lmnop", "postgres", 1},
	}
	for _, p := range pods {
		mgr.RegisterDemoPod(p.group, p.ns, p.pod, p.container)
		seedPodLogs(store, p)
	}
}

// lineGen generates one log line for the given timestamp.
type lineGen func(t time.Time) string

func seedPodLogs(store *storage.Store, p demoPod) {
	// Offset per variant so replica pod histories don't perfectly overlap.
	base := time.Now().Add(-30 * time.Minute).Add(time.Duration(p.variant) * 97 * time.Second)
	for i, gen := range demoLineGens(p) {
		t := base.Add(time.Duration(i) * 23 * time.Second)
		store.Append(p.group, p.ns, p.pod, p.container, gen(t))
	}
}

// st returns a slog-text formatted lineGen.
func st(level, msg string, kv ...string) lineGen {
	return func(t time.Time) string {
		s := fmt.Sprintf("time=%s level=%s msg=%q", t.Format(time.RFC3339), level, msg)
		for i := 0; i+1 < len(kv); i += 2 {
			s += fmt.Sprintf(" %s=%s", kv[i], kv[i+1])
		}
		return s
	}
}

// sj returns a slog-JSON formatted lineGen.
func sj(level, msg string, kv ...string) lineGen {
	return func(t time.Time) string {
		s := fmt.Sprintf(`{"time":%q,"level":%q,"msg":%q`, t.Format(time.RFC3339), level, msg)
		for i := 0; i+1 < len(kv); i += 2 {
			s += fmt.Sprintf(`,%q:%q`, kv[i], kv[i+1])
		}
		return s + "}"
	}
}

// mysql returns a MySQL-style log lineGen.
func mysql(severity, msg string) lineGen {
	return func(t time.Time) string {
		return fmt.Sprintf("%s [%s] %s", t.Format("2006-01-02T15:04:05"), severity, msg)
	}
}

// pg returns a Postgres-style log lineGen.
func pg(severity, msg string) lineGen {
	return func(t time.Time) string {
		return fmt.Sprintf("%s UTC [1] %s:  %s", t.Format("2006-01-02 15:04:05.000"), severity, msg)
	}
}

func demoLineGens(p demoPod) []lineGen {
	switch p.group {
	case "serverPods":
		return serverLogGens(p.variant)
	case "workerPods":
		return workerLogGens(p.variant)
	case "databasePods":
		return databaseLogGens(p)
	}
	return []lineGen{func(t time.Time) string { return "INFO starting" }}
}

func serverLogGens(variant int) []lineGen {
	startup := []lineGen{
		st("INFO", "server starting", "version", "v1.4.2", "commit", "a3f9d2c"),
		st("INFO", "loaded config", "env", "production", "region", "us-east-1"),
		st("DEBUG", "connecting to database", "addr", "mysql-0.db-ns.svc:3306"),
		st("INFO", "database connection pool ready", "min", "5", "max", "20"),
		st("DEBUG", "loading feature flags", "count", "47", "source", "config-service"),
		st("INFO", "server listening", "addr", ":8080"),
	}

	var traffic []lineGen
	switch variant {
	case 0: // checkout pod — payment service circuit breaker scenario
		traffic = []lineGen{
			st("DEBUG", "incoming request", "method", "GET", "path", "/api/v1/health", "req", "req_c0001"),
			st("INFO", "request complete", "method", "GET", "path", "/api/v1/health", "status", "200", "latency", "1ms", "req", "req_c0001"),
			st("DEBUG", "incoming request", "method", "POST", "path", "/api/v1/checkout", "req", "req_c0002"),
			st("DEBUG", "cache miss", "key", "cart:u_5521"),
			st("DEBUG", "db query", "table", "carts", "rows", "8", "duration", "3ms", "req", "req_c0002"),
			st("DEBUG", "calling payment service", "addr", "payment.svc:443", "req", "req_c0002"),
			st("INFO", "request complete", "method", "POST", "path", "/api/v1/checkout", "status", "201", "latency", "143ms", "req", "req_c0002"),
			st("DEBUG", "incoming request", "method", "POST", "path", "/api/v1/checkout", "req", "req_c0003"),
			st("DEBUG", "cache hit", "key", "cart:u_5892"),
			st("DEBUG", "calling payment service", "addr", "payment.svc:443", "req", "req_c0003"),
			st("INFO", "request complete", "method", "POST", "path", "/api/v1/checkout", "status", "201", "latency", "89ms", "req", "req_c0003"),
			st("DEBUG", "GC pause", "duration", "1.2ms", "heap_mb", "138"),
			st("DEBUG", "incoming request", "method", "POST", "path", "/api/v1/checkout", "req", "req_c0004"),
			st("DEBUG", "calling payment service", "addr", "payment.svc:443", "req", "req_c0004"),
			st("WARN", "payment service latency high", "p99_ms", "812", "threshold_ms", "500", "req", "req_c0004"),
			st("INFO", "request complete", "method", "POST", "path", "/api/v1/checkout", "status", "201", "latency", "1012ms", "req", "req_c0004"),
			st("WARN", "payment service latency high", "p99_ms", "1240", "threshold_ms", "500"),
			st("DEBUG", "incoming request", "method", "POST", "path", "/api/v1/checkout", "req", "req_c0005"),
			st("ERROR", "payment service call failed", "addr", "payment.svc:443", "error", "i/o timeout", "req", "req_c0005"),
			st("WARN", "retrying payment service", "attempt", "1/3", "backoff", "1s", "req", "req_c0005"),
			st("ERROR", "payment service call failed", "addr", "payment.svc:443", "error", "i/o timeout", "req", "req_c0005"),
			st("WARN", "retrying payment service", "attempt", "2/3", "backoff", "2s", "req", "req_c0005"),
			st("ERROR", "payment service call failed", "addr", "payment.svc:443", "error", "i/o timeout", "req", "req_c0005"),
			st("ERROR", "payment service circuit breaker open", "addr", "payment.svc:443"),
			st("ERROR", "request failed", "method", "POST", "path", "/api/v1/checkout", "status", "503", "latency", "6021ms", "req", "req_c0005"),
			st("DEBUG", "incoming request", "method", "GET", "path", "/api/v1/health", "req", "req_c0006"),
			st("INFO", "request complete", "method", "GET", "path", "/api/v1/health", "status", "200", "latency", "1ms", "req", "req_c0006"),
			st("ERROR", "request rejected: circuit breaker open", "method", "POST", "path", "/api/v1/checkout", "status", "503", "req", "req_c0007"),
			st("ERROR", "request rejected: circuit breaker open", "method", "POST", "path", "/api/v1/checkout", "status", "503", "req", "req_c0008"),
			st("INFO", "payment service health probe success", "addr", "payment.svc:443", "latency_ms", "31"),
			st("INFO", "circuit breaker half-open: allowing probe request"),
			st("DEBUG", "incoming request", "method", "POST", "path", "/api/v1/checkout", "req", "req_c0009"),
			st("DEBUG", "calling payment service", "addr", "payment.svc:443", "req", "req_c0009"),
			st("INFO", "circuit breaker closed", "addr", "payment.svc:443"),
			st("INFO", "request complete", "method", "POST", "path", "/api/v1/checkout", "status", "201", "latency", "112ms", "req", "req_c0009"),
			st("DEBUG", "incoming request", "method", "POST", "path", "/api/v1/checkout", "req", "req_c0010"),
			st("INFO", "request complete", "method", "POST", "path", "/api/v1/checkout", "status", "201", "latency", "98ms", "req", "req_c0010"),
			st("DEBUG", "metrics flush", "counters", "48", "histograms", "12"),
			st("INFO", "metrics exported", "endpoint", "prometheus", "series", "847"),
			st("DEBUG", "incoming request", "method", "POST", "path", "/api/v1/checkout", "req", "req_c0011"),
			st("INFO", "request complete", "method", "POST", "path", "/api/v1/checkout", "status", "201", "latency", "102ms", "req", "req_c0011"),
			st("DEBUG", "GC pause", "duration", "0.8ms", "heap_mb", "144"),
		}

	case 1: // auth/user pod — brute-force detection + normal traffic
		traffic = []lineGen{
			st("DEBUG", "incoming request", "method", "POST", "path", "/api/v1/auth/login", "req", "req_a0001"),
			st("DEBUG", "db query", "table", "users", "op", "SELECT", "duration", "2ms", "req", "req_a0001"),
			st("DEBUG", "password hash check", "duration", "31ms", "req", "req_a0001"),
			st("INFO", "user login", "user_id", "u_5521", "req", "req_a0001"),
			st("INFO", "request complete", "method", "POST", "path", "/api/v1/auth/login", "status", "200", "latency", "38ms", "req", "req_a0001"),
			st("DEBUG", "incoming request", "method", "GET", "path", "/api/v1/users/u_5521", "req", "req_a0002"),
			st("DEBUG", "cache miss", "key", "user:u_5521"),
			st("DEBUG", "db query", "table", "users", "op", "SELECT", "duration", "3ms", "req", "req_a0002"),
			st("DEBUG", "cache set", "key", "user:u_5521", "ttl", "300s"),
			st("INFO", "request complete", "method", "GET", "path", "/api/v1/users/u_5521", "status", "200", "latency", "7ms", "req", "req_a0002"),
			st("DEBUG", "incoming request", "method", "POST", "path", "/api/v1/auth/login", "req", "req_a0003"),
			st("WARN", "login failed: invalid password", "user", "admin@example.com", "ip", "203.0.113.42", "req", "req_a0003"),
			st("INFO", "request complete", "method", "POST", "path", "/api/v1/auth/login", "status", "401", "latency", "32ms", "req", "req_a0003"),
			st("WARN", "login failed: invalid password", "user", "admin@example.com", "ip", "203.0.113.42", "attempts", "2"),
			st("WARN", "login failed: invalid password", "user", "admin@example.com", "ip", "203.0.113.42", "attempts", "3"),
			st("WARN", "brute force detected: account locked", "user", "admin@example.com", "ip", "203.0.113.42", "duration", "15m"),
			st("DEBUG", "incoming request", "method", "GET", "path", "/api/v1/users", "req", "req_a0004"),
			st("DEBUG", "cache hit", "key", "users:list:page=1"),
			st("INFO", "request complete", "method", "GET", "path", "/api/v1/users", "status", "200", "latency", "3ms", "req", "req_a0004"),
			st("DEBUG", "session expiry sweep", "expired", "24", "active", "8471"),
			st("DEBUG", "incoming request", "method", "DELETE", "path", "/api/v1/auth/sessions/tok_abc123", "req", "req_a0005"),
			st("INFO", "user logout", "user_id", "u_7741", "req", "req_a0005"),
			st("INFO", "request complete", "method", "DELETE", "path", "/api/v1/auth/sessions/tok_abc123", "status", "204", "latency", "4ms", "req", "req_a0005"),
			st("DEBUG", "incoming request", "method", "POST", "path", "/api/v1/users", "req", "req_a0006"),
			st("DEBUG", "db query", "table", "users", "op", "INSERT", "duration", "5ms", "req", "req_a0006"),
			st("INFO", "user created", "user_id", "u_9012", "req", "req_a0006"),
			st("INFO", "request complete", "method", "POST", "path", "/api/v1/users", "status", "201", "latency", "18ms", "req", "req_a0006"),
			st("DEBUG", "GC pause", "duration", "1.1ms", "heap_mb", "121"),
			st("DEBUG", "incoming request", "method", "PATCH", "path", "/api/v1/users/u_5521", "req", "req_a0007"),
			st("DEBUG", "db query", "table", "users", "op", "UPDATE", "duration", "4ms", "req", "req_a0007"),
			st("DEBUG", "cache invalidate", "key", "user:u_5521"),
			st("INFO", "request complete", "method", "PATCH", "path", "/api/v1/users/u_5521", "status", "200", "latency", "9ms", "req", "req_a0007"),
			st("DEBUG", "incoming request", "method", "POST", "path", "/api/v1/auth/token/refresh", "req", "req_a0008"),
			st("INFO", "token refreshed", "user_id", "u_5521", "req", "req_a0008"),
			st("INFO", "request complete", "method", "POST", "path", "/api/v1/auth/token/refresh", "status", "200", "latency", "6ms", "req", "req_a0008"),
			st("WARN", "rate limit reached", "ip", "10.0.0.15", "limit", "500/min", "current", "501"),
			st("INFO", "metrics exported", "endpoint", "prometheus", "series", "712"),
			st("DEBUG", "incoming request", "method", "GET", "path", "/api/v1/users/u_5521", "req", "req_a0009"),
			st("DEBUG", "cache hit", "key", "user:u_5521"),
			st("INFO", "request complete", "method", "GET", "path", "/api/v1/users/u_5521", "status", "200", "latency", "2ms", "req", "req_a0009"),
		}

	case 2: // catalog/products pod — slow DB queries + connection pool exhaustion
		traffic = []lineGen{
			st("DEBUG", "incoming request", "method", "GET", "path", "/api/v1/products", "req", "req_p0001"),
			st("DEBUG", "cache miss", "key", "products:list:page=1"),
			st("DEBUG", "db query", "table", "products", "op", "SELECT", "rows", "50", "duration", "8ms", "req", "req_p0001"),
			st("DEBUG", "cache set", "key", "products:list:page=1", "ttl", "60s"),
			st("INFO", "request complete", "method", "GET", "path", "/api/v1/products", "status", "200", "latency", "22ms", "req", "req_p0001"),
			st("DEBUG", "incoming request", "method", "GET", "path", "/api/v1/products/p_9821", "req", "req_p0002"),
			st("DEBUG", "cache hit", "key", "product:p_9821"),
			st("INFO", "request complete", "method", "GET", "path", "/api/v1/products/p_9821", "status", "200", "latency", "2ms", "req", "req_p0002"),
			st("DEBUG", "incoming request", "method", "GET", "path", "/api/v1/categories", "req", "req_p0003"),
			st("DEBUG", "db query", "table", "categories", "op", "SELECT", "rows", "128", "duration", "11ms", "req", "req_p0003"),
			st("INFO", "request complete", "method", "GET", "path", "/api/v1/categories", "status", "200", "latency", "14ms", "req", "req_p0003"),
			st("DEBUG", "incoming request", "method", "GET", "path", "/api/v1/products", "req", "req_p0004", "sort", "price_desc"),
			st("DEBUG", "cache miss", "key", "products:list:page=1:sort=price_desc"),
			st("DEBUG", "db query", "table", "products", "op", "SELECT", "rows", "50", "duration", "41ms", "req", "req_p0004"),
			st("WARN", "slow db query", "table", "products", "duration_ms", "41", "threshold_ms", "30", "req", "req_p0004"),
			st("INFO", "request complete", "method", "GET", "path", "/api/v1/products", "status", "200", "latency", "44ms", "req", "req_p0004"),
			st("DEBUG", "incoming request", "method", "GET", "path", "/api/v1/products/search", "req", "req_p0005", "q", "wireless+headphones"),
			st("DEBUG", "search index query", "terms", "2", "duration", "18ms", "req", "req_p0005"),
			st("INFO", "request complete", "method", "GET", "path", "/api/v1/products/search", "status", "200", "latency", "21ms", "req", "req_p0005"),
			st("DEBUG", "incoming request", "method", "GET", "path", "/api/v1/products", "req", "req_p0006", "filter", "in_stock=true&category=electronics"),
			st("DEBUG", "db query", "table", "products", "op", "SELECT", "rows", "37", "duration", "68ms", "req", "req_p0006"),
			st("WARN", "slow db query", "table", "products", "duration_ms", "68", "threshold_ms", "30", "req", "req_p0006"),
			st("INFO", "request complete", "method", "GET", "path", "/api/v1/products", "status", "200", "latency", "71ms", "req", "req_p0006"),
			st("WARN", "db connection pool exhausted", "active", "20", "max", "20", "waiting", "3"),
			st("DEBUG", "incoming request", "method", "GET", "path", "/api/v1/products", "req", "req_p0007"),
			st("DEBUG", "db query", "table", "products", "op", "SELECT", "rows", "50", "duration", "182ms", "req", "req_p0007"),
			st("ERROR", "db query timeout", "table", "products", "duration_ms", "182", "timeout_ms", "150", "req", "req_p0007"),
			st("ERROR", "request failed", "method", "GET", "path", "/api/v1/products", "status", "500", "latency", "182ms", "req", "req_p0007"),
			st("INFO", "db connection pool recovered", "active", "15", "max", "20"),
			st("DEBUG", "incoming request", "method", "GET", "path", "/api/v1/products", "req", "req_p0008"),
			st("DEBUG", "db query", "table", "products", "op", "SELECT", "rows", "50", "duration", "9ms", "req", "req_p0008"),
			st("INFO", "request complete", "method", "GET", "path", "/api/v1/products", "status", "200", "latency", "12ms", "req", "req_p0008"),
			st("DEBUG", "GC pause", "duration", "1.5ms", "heap_mb", "156"),
			st("DEBUG", "incoming request", "method", "PUT", "path", "/api/v1/products/p_9821", "req", "req_p0009"),
			st("DEBUG", "db query", "table", "products", "op", "UPDATE", "duration", "5ms", "req", "req_p0009"),
			st("DEBUG", "cache invalidate", "key", "product:p_9821"),
			st("INFO", "request complete", "method", "PUT", "path", "/api/v1/products/p_9821", "status", "200", "latency", "10ms", "req", "req_p0009"),
			st("INFO", "metrics exported", "endpoint", "prometheus", "series", "731"),
		}
	}

	tail := []lineGen{
		st("INFO", "SIGHUP received: reloading config"),
		st("DEBUG", "reloading feature flags", "count", "47"),
		st("INFO", "config reloaded", "changed_keys", "2"),
		st("DEBUG", "incoming request", "method", "GET", "path", "/api/v1/health", "req", "req_z0001"),
		st("INFO", "request complete", "method", "GET", "path", "/api/v1/health", "status", "200", "latency", "1ms", "req", "req_z0001"),
	}

	return append(append(startup, traffic...), tail...)
}

func workerLogGens(variant int) []lineGen {
	startup := []lineGen{
		sj("INFO", "worker starting", "queue", "jobs", "concurrency", "4", "version", "v1.4.2"),
		sj("INFO", "connected to broker", "addr", "redis-0.cache-ns.svc:6379"),
		sj("DEBUG", "registering job handlers", "types", "6"),
		sj("INFO", "worker ready"),
	}

	var jobs []lineGen
	switch variant {
	case 0: // email + webhook delivery
		jobs = []lineGen{
			sj("INFO", "job dequeued", "type", "email:welcome", "id", "j_1001", "user_id", "u_9012"),
			sj("DEBUG", "sending email", "to", "newuser@example.com", "template", "welcome"),
			sj("INFO", "job complete", "type", "email:welcome", "id", "j_1001", "duration", "234ms"),
			sj("INFO", "job dequeued", "type", "email:password_reset", "id", "j_1002", "user_id", "u_7741"),
			sj("DEBUG", "sending email", "to", "user@example.com", "template", "password_reset"),
			sj("INFO", "job complete", "type", "email:password_reset", "id", "j_1002", "duration", "187ms"),
			sj("INFO", "job dequeued", "type", "webhook:delivery", "id", "j_1003", "user_id", "u_5521"),
			sj("DEBUG", "delivering webhook", "url", "https://hooks.customer.io/abc123", "event", "user.created"),
			sj("INFO", "job complete", "type", "webhook:delivery", "id", "j_1003", "duration", "312ms"),
			sj("INFO", "job dequeued", "type", "email:order_confirmation", "id", "j_1004", "user_id", "u_5521"),
			sj("DEBUG", "sending email", "to", "user@example.com", "template", "order_confirmation"),
			sj("INFO", "job complete", "type", "email:order_confirmation", "id", "j_1004", "duration", "198ms"),
			sj("INFO", "job dequeued", "type", "webhook:delivery", "id", "j_1019", "user_id", "u_5891"),
			sj("DEBUG", "delivering webhook", "url", "https://api.slowvendor.io/webhook", "event", "order.created"),
			sj("ERROR", "webhook delivery failed", "id", "j_1019", "error", "connection timeout", "attempt", "1"),
			sj("WARN", "retrying job", "id", "j_1019", "attempt", "2", "delay", "5s"),
			sj("ERROR", "webhook delivery failed", "id", "j_1019", "error", "connection timeout", "attempt", "2"),
			sj("WARN", "retrying job", "id", "j_1019", "attempt", "3", "delay", "10s"),
			sj("ERROR", "webhook delivery failed", "id", "j_1019", "error", "connection timeout", "attempt", "3"),
			sj("ERROR", "job failed: max retries exceeded", "id", "j_1019", "moved_to", "dead_letter"),
			sj("INFO", "job dequeued", "type", "email:welcome", "id", "j_1020", "user_id", "u_9013"),
			sj("DEBUG", "sending email", "to", "another@example.com", "template", "welcome"),
			sj("INFO", "job complete", "type", "email:welcome", "id", "j_1020", "duration", "221ms"),
			sj("DEBUG", "queue stats", "pending", "14", "processing", "4", "failed", "1", "dead", "3"),
			sj("INFO", "job dequeued", "type", "webhook:delivery", "id", "j_1021", "user_id", "u_8821"),
			sj("DEBUG", "delivering webhook", "url", "https://hooks.stripe.com/events/abc", "event", "payment.succeeded"),
			sj("INFO", "job complete", "type", "webhook:delivery", "id", "j_1021", "duration", "89ms"),
		}
	case 1: // report generation + CSV export
		jobs = []lineGen{
			sj("INFO", "job dequeued", "type", "report:daily", "id", "j_2001", "org_id", "org_100"),
			sj("DEBUG", "fetching report data", "period", "last_24h", "org", "org_100"),
			sj("DEBUG", "db query", "table", "events", "rows", "142001", "duration", "1.8s"),
			sj("WARN", "report data fetch slow", "duration", "1.8s", "threshold", "1s", "id", "j_2001"),
			sj("DEBUG", "generating PDF", "pages", "12", "id", "j_2001"),
			sj("INFO", "job complete", "type", "report:daily", "id", "j_2001", "duration", "4.2s"),
			sj("INFO", "job dequeued", "type", "export:csv", "id", "j_2002", "user_id", "u_5500"),
			sj("DEBUG", "exporting data", "table", "orders", "filter", "last_30d"),
			sj("DEBUG", "rows exported", "count", "8472"),
			sj("INFO", "job complete", "type", "export:csv", "id", "j_2002", "duration", "892ms"),
			sj("INFO", "job dequeued", "type", "report:weekly", "id", "j_2003", "org_id", "org_200"),
			sj("DEBUG", "fetching report data", "period", "last_7d", "org", "org_200"),
			sj("DEBUG", "db query", "table", "events", "rows", "1042819", "duration", "8.1s"),
			sj("ERROR", "report generation failed", "id", "j_2003", "error", "db query timeout after 10s"),
			sj("WARN", "retrying job", "id", "j_2003", "attempt", "2", "delay", "30s"),
			sj("DEBUG", "db query", "table", "events", "rows", "1042819", "duration", "7.4s"),
			sj("DEBUG", "generating PDF", "pages", "48", "id", "j_2003"),
			sj("INFO", "job complete", "type", "report:weekly", "id", "j_2003", "duration", "14.2s"),
			sj("DEBUG", "queue stats", "pending", "7", "processing", "2", "failed", "0", "dead", "1"),
			sj("INFO", "job dequeued", "type", "export:csv", "id", "j_2004", "user_id", "u_5521"),
			sj("DEBUG", "exporting data", "table", "invoices", "filter", "last_90d"),
			sj("DEBUG", "rows exported", "count", "312"),
			sj("INFO", "job complete", "type", "export:csv", "id", "j_2004", "duration", "204ms"),
		}
	}

	tail := []lineGen{
		sj("DEBUG", "heartbeat", "processed", "47", "failed", "2", "uptime", "1800s"),
	}

	return append(append(startup, jobs...), tail...)
}

func databaseLogGens(p demoPod) []lineGen {
	if p.container == "mysql" {
		return mysqlLogGens()
	}
	return postgresLogGens()
}

func mysqlLogGens() []lineGen {
	return []lineGen{
		mysql("Note", "mysqld: starting up"),
		mysql("Note", "InnoDB: innodb_file_per_table=ON"),
		mysql("Note", "InnoDB: Buffer pool size = 128M"),
		mysql("Note", "InnoDB: Completed initialization of buffer pool"),
		mysql("Note", "InnoDB: 128 rollback segment(s) are active"),
		mysql("Note", "InnoDB: Buffer pool(s) load completed at startup"),
		mysql("Note", "mysqld: ready for connections. Version: '8.0.34' socket: '/var/run/mysqld/mysqld.sock' port: 3306"),
		mysql("Note", "Got connection id 1040 from 10.0.1.5"),
		mysql("Note", "Got connection id 1041 from 10.0.1.8"),
		mysql("Note", "Query_time: 0.001241  Lock_time: 0.000102 Rows_sent: 1 Rows_examined: 1"),
		mysql("Note", "Got connection id 1042 from 10.0.1.5"),
		mysql("Note", "Query_time: 0.002341  Lock_time: 0.000102 Rows_sent: 25 Rows_examined: 25"),
		mysql("Warning", "Aborted connection 1040 to db: 'appdb' user: 'appuser' host: '10.0.1.5' (Got an error reading communication packets)"),
		mysql("Note", "Got connection id 1043 from 10.0.1.8"),
		mysql("Note", "Query_time: 0.045182  Lock_time: 0.000041 Rows_sent: 0 Rows_examined: 0"),
		mysql("Note", "InnoDB: page_cleaner: 1000ms intended loop took 1234ms. The settings might not be optimal."),
		mysql("Note", "Got connection id 1044 from 10.0.2.3"),
		mysql("Note", "Query_time: 0.001002  Lock_time: 0.000088 Rows_sent: 1 Rows_examined: 1"),
		mysql("Warning", "IP address '10.0.2.99' could not be resolved: Name or service not known"),
		mysql("Note", "Slow query logged (threshold: 10ms): SELECT * FROM orders WHERE status='pending' ORDER BY created_at DESC LIMIT 100"),
		mysql("Note", "Got connection id 1045 from 10.0.1.5"),
		mysql("Note", "Query_time: 0.012401  Lock_time: 0.000210 Rows_sent: 100 Rows_examined: 45219"),
		mysql("Warning", "Slow query: 12ms -- SELECT * FROM orders WHERE status='pending' ORDER BY created_at DESC LIMIT 100"),
		mysql("Note", "Query_time: 0.001112  Lock_time: 0.000099 Rows_sent: 1 Rows_examined: 1"),
		mysql("Note", "InnoDB: Buffer pool pages flushed: 128"),
		mysql("Note", "Got connection id 1046 from 10.0.1.8"),
		mysql("Note", "Query_time: 0.000841  Lock_time: 0.000031 Rows_sent: 8 Rows_examined: 8"),
		mysql("Warning", "Aborted connection 1043 to db: 'appdb' user: 'appuser' host: '10.0.1.8' (Got an error reading communication packets)"),
		mysql("Note", "Received SIGHUP, reloading tables"),
		mysql("Note", "Got connection id 1047 from 10.0.1.5"),
		mysql("Note", "Query_time: 0.002101  Lock_time: 0.000142 Rows_sent: 50 Rows_examined: 50"),
		mysql("Note", "InnoDB: Buffer pool pages flushed: 64"),
		mysql("Note", "Got connection id 1048 from 10.0.2.3"),
		mysql("Note", "Query_time: 0.000741  Lock_time: 0.000061 Rows_sent: 3 Rows_examined: 3"),
	}
}

func postgresLogGens() []lineGen {
	return []lineGen{
		pg("LOG", "database system was shut down at startup"),
		pg("LOG", "database system is ready to accept connections"),
		pg("LOG", "checkpoint starting: time"),
		pg("LOG", "checkpoint complete: wrote 128 buffers (0.8%); 0 WAL file(s) added, 0 removed, 1 recycled"),
		pg("LOG", "connection received: host=10.0.1.8 port=54312"),
		pg("LOG", "connection authorized: user=replica database=replication"),
		pg("LOG", "checkpoint starting: time"),
		pg("LOG", "duration: 12.345 ms  statement: SELECT count(*) FROM events WHERE created_at > now() - interval '1 hour'"),
		pg("LOG", "checkpoint complete: wrote 64 buffers (0.4%)"),
		pg("WARNING", "could not serialize access due to concurrent update"),
		pg("LOG", "statement: UPDATE jobs SET status='running' WHERE id=9981 AND status='pending'"),
		pg("LOG", "checkpoint starting: time"),
		pg("LOG", "connection received: host=10.0.1.5 port=61204"),
		pg("LOG", "connection authorized: user=appuser database=appdb"),
		pg("LOG", "duration: 8.112 ms  statement: SELECT * FROM products WHERE category_id=42 ORDER BY price ASC LIMIT 50"),
		pg("LOG", "autovacuum: processing database \"appdb\""),
		pg("LOG", "automatic vacuum of table \"appdb.public.events\": index scans: 1 pages: 0 removed, 1498 remain tuples: 24821 removed, 1042819 remain"),
		pg("LOG", "checkpoint starting: time"),
		pg("LOG", "duration: 147.221 ms  statement: SELECT e.*, u.name FROM events e JOIN users u ON e.user_id = u.id WHERE e.created_at > now() - interval '7 days'"),
		pg("WARNING", "query duration exceeded log_min_duration_statement: 147.221 ms"),
		pg("LOG", "checkpoint complete: wrote 212 buffers (1.3%); 0 WAL file(s) added, 1 removed, 2 recycled"),
		pg("LOG", "connection received: host=10.0.2.3 port=49218"),
		pg("LOG", "connection authorized: user=appuser database=appdb"),
		pg("LOG", "duration: 3.441 ms  statement: SELECT * FROM users WHERE id=$1"),
		pg("LOG", "duration: 5.112 ms  statement: INSERT INTO audit_log (user_id, action, created_at) VALUES ($1, $2, now())"),
		pg("LOG", "checkpoint starting: time"),
		pg("LOG", "replication slot \"replica1\" advanced to 0/5000000"),
		pg("LOG", "checkpoint complete: wrote 98 buffers (0.6%); 0 WAL file(s) added, 0 removed, 1 recycled"),
		pg("LOG", "duration: 2.881 ms  statement: SELECT count(*) FROM orders WHERE user_id=$1"),
		pg("LOG", "pg_hba.conf reload requested"),
		pg("LOG", "duration: 1.221 ms  statement: SELECT * FROM users WHERE email=$1"),
		pg("LOG", "autovacuum: processing database \"appdb\""),
	}
}
