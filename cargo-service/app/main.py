import os
import random
import time
import requests
from fastapi import FastAPI, Response, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from prometheus_client import Counter, Histogram, generate_latest, CONTENT_TYPE_LATEST

app = FastAPI(title="Space Cargo Service", version="1.0.0")

# Enable CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Prometheus Metrics
HTTP_REQUESTS_TOTAL = Counter(
    "cargo_http_requests_total",
    "Total HTTP requests to Cargo Service",
    ["method", "endpoint", "status"]
)
REQUEST_LATENCY = Histogram(
    "cargo_request_latency_seconds",
    "HTTP request latency in seconds",
    ["endpoint"]
)
CARGO_CREATED_TOTAL = Counter(
    "cargo_created_total",
    "Total cargo shipments created"
)

# Configuration from Environment Variables
TELEMETRY_SERVICE_URL = os.getenv("TELEMETRY_SERVICE_URL", "http://localhost:8002")

# In-Memory DB
cargo_db = [
    {"id": "CRG-101", "name": "Vaporized Fuel Core", "destination": "Mars Alpha Colony", "status": "Active", "weight_kg": 1200},
    {"id": "CRG-102", "name": "Hydroponic Bio-Seeds", "destination": "Luna Station 4", "status": "Active", "weight_kg": 450},
    {"id": "CRG-103", "name": "Quantum Relay Subsystem", "destination": "Titan Outpost", "status": "Active", "weight_kg": 85},
]

# Artificial Error Simulation Config
error_rate = 0.0  # Percentage between 0.0 and 1.0

class ErrorConfig(BaseModel):
    rate: float  # e.g., 0.5 for 50% error rate

class CargoItem(BaseModel):
    name: str
    destination: str
    weight_kg: float

# Middleware to measure request latency, log count, and inject errors
@app.middleware("http")
async def monitor_and_simulate_errors(request: Request, call_next):
    endpoint = request.url.path
    method = request.method
    
    # Exclude metrics, health, and error config routes from error injection
    is_management_route = endpoint in ["/metrics", "/health", "/api/cargo/simulate-errors", "/"]
    
    if not is_management_route and error_rate > 0:
        if random.random() < error_rate:
            HTTP_REQUESTS_TOTAL.labels(method=method, endpoint=endpoint, status=500).inc()
            return Response("Simulated Internal Server Error (Istio Practice)", status_code=500)
    
    start_time = time.time()
    try:
        response = await call_next(request)
        duration = time.time() - start_time
        
        # Track metrics
        REQUEST_LATENCY.labels(endpoint=endpoint).observe(duration)
        HTTP_REQUESTS_TOTAL.labels(method=method, endpoint=endpoint, status=response.status_code).inc()
        return response
    except Exception as e:
        duration = time.time() - start_time
        HTTP_REQUESTS_TOTAL.labels(method=method, endpoint=endpoint, status=500).inc()
        raise e

@app.get("/")
def read_root():
    return {"service": "cargo-service", "status": "running"}

@app.get("/health")
def health_check():
    return {"status": "healthy"}

@app.get("/metrics")
def get_metrics():
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)

@app.get("/api/cargo")
def get_all_cargo():
    return cargo_db

@app.post("/api/cargo")
def create_cargo(item: CargoItem):
    new_id = f"CRG-{random.randint(104, 999)}"
    cargo = {
        "id": new_id,
        "name": item.name,
        "destination": item.destination,
        "status": "Active",
        "weight_kg": item.weight_kg
    }
    cargo_db.append(cargo)
    CARGO_CREATED_TOTAL.inc()
    return cargo

@app.get("/api/cargo/{cargo_id}")
def get_cargo_details(cargo_id: str):
    # Find cargo
    cargo = next((item for item in cargo_db if item["id"] == cargo_id), None)
    if not cargo:
        raise HTTPException(status_code=404, detail="Cargo shipment not found")
    
    # Query telemetry service to fetch real-time container metrics
    try:
        response = requests.get(f"{TELEMETRY_SERVICE_URL}/api/telemetry/{cargo_id}", timeout=2.0)
        if response.status_code == 200:
            telemetry_data = response.json()
        else:
            telemetry_data = {"error": "Telemetry service returned non-200", "details": response.text}
    except Exception as err:
        telemetry_data = {"error": f"Failed to connect to telemetry service: {str(err)}"}
        
    return {
        "cargo": cargo,
        "telemetry": telemetry_data
    }

@app.post("/api/cargo/simulate-errors")
def configure_errors(config: ErrorConfig):
    global error_rate
    # Bound the rate between 0.0 and 1.0
    error_rate = max(0.0, min(1.0, config.rate))
    return {"message": f"Error simulation rate set to {error_rate * 100}%"}

@app.get("/api/cargo/error-rate")
def get_error_rate():
    return {"error_rate": error_rate}
