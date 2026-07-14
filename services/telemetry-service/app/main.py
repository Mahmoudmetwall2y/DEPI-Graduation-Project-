import random
import time
import threading
from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from prometheus_client import Counter, Gauge, generate_latest, CONTENT_TYPE_LATEST

app = FastAPI(title="Space Telemetry Service", version="1.0.0")

# Enable CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Prometheus Metrics
TELEMETRY_REQUESTS_TOTAL = Counter(
    "telemetry_requests_total",
    "Total requests to Telemetry Service",
    ["cargo_id"]
)
LOAD_SIMULATIONS_ACTIVE = Gauge(
    "telemetry_load_simulations_active",
    "Number of active CPU load simulation threads"
)
CPU_BURNING_GAUGE = Gauge(
    "telemetry_cpu_burning_status",
    "Current state of CPU burning (1 = running, 0 = idle)"
)

# Active CPU threads tracking
active_load_threads = 0
lock = threading.Lock()

class LoadSimulationRequest(BaseModel):
    duration_seconds: int = 30
    cores: int = 1

def cpu_burner(duration: int):
    global active_load_threads
    with lock:
        active_load_threads += 1
        LOAD_SIMULATIONS_ACTIVE.set(active_load_threads)
        CPU_BURNING_GAUGE.set(1)

    end_time = time.time() + duration
    # Perform math in a tight loop to consume 100% of CPU slice
    while time.time() < end_time:
        _ = [x**2 for x in range(1000)]

    with lock:
        active_load_threads -= 1
        LOAD_SIMULATIONS_ACTIVE.set(active_load_threads)
        if active_load_threads == 0:
            CPU_BURNING_GAUGE.set(0)

@app.get("/")
def read_root():
    return {"service": "telemetry-service", "status": "running"}

@app.get("/health")
def health_check():
    return {"status": "healthy"}

@app.get("/metrics")
def get_metrics():
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)

@app.get("/api/telemetry/load-status")
def get_load_status():
    return {
        "load_simulation_active": active_load_threads > 0,
        "active_simulation_threads": active_load_threads
    }
@app.get("/api/telemetry/{cargo_id}")
def get_telemetry(cargo_id: str):
    TELEMETRY_REQUESTS_TOTAL.labels(cargo_id=cargo_id).inc()
    
    # Generate deterministic-looking yet dynamic telemetry using cargo_id as seed
    seed_val = sum(ord(char) for char in cargo_id)
    random.seed(seed_val + int(time.time() / 10)) # updates every 10 seconds
    
    temp = round(20.0 + random.uniform(-5.0, 5.0), 2)
    fuel = round(85.0 - (time.time() % 3600) / 120.0, 2) # slowly drops over the hour
    vibration = round(random.uniform(0.1, 4.5), 2)
    pressure = round(101.3 + random.uniform(-2.0, 2.0), 2)
    
    status = "Optimal"
    if vibration > 4.4 or temp > 24.8:
        status = "Critical"
    elif vibration > 4.0 or temp > 24.0:
        status = "Warning"

    return {
        "cargo_id": cargo_id,
        "temperature_celsius": temp,
        "fuel_percentage": max(0.0, fuel),
        "vibration_g": vibration,
        "atmospheric_pressure_kpa": pressure,
        "status": status,
        "timestamp": time.time()
    }

@app.post("/api/telemetry/simulate-load")
def trigger_load_simulation(request: LoadSimulationRequest):
    duration = min(300, max(5, request.duration_seconds)) # cap between 5s and 5m
    cores = min(4, max(1, request.cores)) # cap cores simulation
    
    for _ in range(cores):
        threading.Thread(target=cpu_burner, args=(duration,), daemon=True).start()
        
    return {
        "message": f"Load simulation triggered successfully on {cores} thread(s) for {duration} seconds.",
        "active_simulations": active_load_threads + cores
    }

