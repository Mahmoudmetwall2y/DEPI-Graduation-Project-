package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Metric declarations
var (
	routingRequestsTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "routing_requests_total",
			Help: "Total number of routing calculations processed.",
		},
		[]string{"destination", "status"},
	)
	routingLatency = prometheus.NewHistogram(
		prometheus.HistogramOpts{
			Name:    "routing_duration_seconds",
			Help:    "Histogram of routing request processing latencies.",
			Buckets: []float64{0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5},
		},
	)
)

func init() {
	prometheus.MustRegister(routingRequestsTotal)
	prometheus.MustRegister(routingLatency)
}

// Latency Configuration
var (
	latencyMu sync.Mutex
	latencyMS int = 0
)

type LatencyConfig struct {
	LatencyMS int `json:"latency_ms"`
}

type RouteResponse struct {
	CargoID     string   `json:"cargo_id"`
	Destination string   `json:"destination"`
	Waypoints   []string `json:"waypoints"`
	DistanceMil float64  `json:"distance_million_km"`
	ETA         string   `json:"eta"`
	LatencyMS   int      `json:"latency_injected_ms"`
	Timestamp   int64    `json:"timestamp"`
}

func main() {
	// Routing handler
	http.HandleFunc("/api/routing/", handleRouting)
	http.HandleFunc("/api/routing/simulate-latency", handleLatencyConfig)
	http.HandleFunc("/api/routing/latency-status", handleLatencyStatus)

	// System endpoints
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"healthy"}`))
	})
	http.Handle("/metrics", promhttp.Handler())

	// Root redirect/status
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"service":"routing-service","status":"running"}`))
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8000"
	}
	log.Printf("Starting Go Routing Service on port %s...", port)
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatalf("Server failed to start: %v", err)
	}
}

func handleRouting(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	// Inject latency if configured
	latencyMu.Lock()
	currentLatency := latencyMS
	latencyMu.Unlock()
	if currentLatency > 0 {
		time.Sleep(time.Duration(currentLatency) * time.Millisecond)
	}

	// Extract Cargo ID from path /api/routing/{cargo_id}
	parts := strings.Split(r.URL.Path, "/")
	cargoID := ""
	if len(parts) >= 4 {
		cargoID = parts[3]
	}
	if cargoID == "" {
		http.Error(w, `{"error":"cargo_id required"}`, http.StatusBadRequest)
		return
	}

	// Read destination from query params (fallback if not passed)
	destination := r.URL.Query().Get("destination")
	if destination == "" {
		destination = "Deep Space"
	}

	// Calculate route waypoints based on destination
	var waypoints []string
	var distance float64
	var eta string

	destLower := strings.ToLower(destination)
	if strings.Contains(destLower, "mars") {
		waypoints = []string{"Earth Orbit", "Luna Gateway", "Asteroid Checkpoint Alpha", "Mars High Orbit", "Mars Colony"}
		distance = 225.3
		eta = "142 Hours"
	} else if strings.Contains(destLower, "luna") || strings.Contains(destLower, "moon") {
		waypoints = []string{"Earth Orbit", "Van Allen Belt", "Luna Station 4"}
		distance = 0.384
		eta = "3 Hours"
	} else if strings.Contains(destLower, "titan") || strings.Contains(destLower, "saturn") {
		waypoints = []string{"Earth Orbit", "Jupiter Assist Node", "Saturn Outer Rings", "Titan Outpost"}
		distance = 1400.5
		eta = "912 Hours"
	} else {
		// Generate random route
		rand.Seed(time.Now().UnixNano() + int64(len(cargoID)))
		sectors := []string{"Beta Sector", "Gemma Sector", "Vega Nexus", "Cygnus Gateway"}
		randomSector := sectors[rand.Intn(len(sectors))]
		waypoints = []string{"Earth Orbit", "Deep Space Gateway", randomSector, destination}
		distance = 500.0 + rand.Float64()*400.0
		eta = fmt.Sprintf("%d Hours", int(distance/3.5))
	}

	response := RouteResponse{
		CargoID:     cargoID,
		Destination: destination,
		Waypoints:   waypoints,
		DistanceMil: mathRound(distance, 2),
		ETA:         eta,
		LatencyMS:   currentLatency,
		Timestamp:   time.Now().Unix(),
	}

	// Increment metrics
	routingRequestsTotal.WithLabelValues(destination, "200").Inc()
	routingLatency.Observe(time.Since(start).Seconds())

	json.NewEncoder(w).Encode(response)
}

func handleLatencyConfig(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == http.MethodOptions {
		return
	}

	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"only POST method allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var config LatencyConfig
	err := json.NewDecoder(r.Body).Decode(&config)
	if err != nil {
		http.Error(w, `{"error":"invalid request payload"}`, http.StatusBadRequest)
		return
	}

	latencyMu.Lock()
	latencyMS = config.LatencyMS
	if latencyMS < 0 {
		latencyMS = 0
	}
	// Limit duration to max 10s for stability
	if latencyMS > 10000 {
		latencyMS = 10000
	}
	currentVal := latencyMS
	latencyMu.Unlock()

	w.Write([]byte(fmt.Sprintf(`{"message":"Latency simulation rate set to %d ms"}`, currentVal)))
}

func handleLatencyStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	latencyMu.Lock()
	currentLatency := latencyMS
	latencyMu.Unlock()

	w.Write([]byte(fmt.Sprintf(`{"latency_ms":%d}`, currentLatency)))
}

func mathRound(val float64, precision int) float64 {
	shift := 1.0
	for i := 0; i < precision; i++ {
		shift *= 10
	}
	return float64(int(val*shift+0.5)) / shift
}
