// Dynamic API base endpoints for local dev vs production (EKS ingress / proxy)
const isLocalDev = window.location.protocol === 'file:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

const CARGO_API = isLocalDev ? 'http://localhost:8000/api/cargo' : '/api/cargo';
const TELEMETRY_API = isLocalDev ? 'http://localhost:8002/api/telemetry' : '/api/telemetry';

let selectedCargoId = null;
let telemetryPollInterval = null;
let loadStatusPollInterval = null;

// DOM Elements
const connectionStatus = document.getElementById('connection-status');
const metricTotalShipments = document.getElementById('metric-total-shipments');
const metricErrorRate = document.getElementById('metric-error-rate');
const metricCpuLoad = document.getElementById('metric-cpu-load');
const metricHpaCard = document.getElementById('metric-hpa-card');

const cargoList = document.getElementById('cargo-list');
const newCargoForm = document.getElementById('new-cargo-form');
const cargoNameInput = document.getElementById('cargo-name');
const cargoDestinationInput = document.getElementById('cargo-destination');
const cargoWeightInput = document.getElementById('cargo-weight');

const telemetryDetails = document.getElementById('telemetry-details');
const noTelemetryFallback = document.getElementById('no-telemetry-fallback');
const selectedCargoTitle = document.getElementById('selected-cargo-title');
const telemetryStatusBanner = document.getElementById('telemetry-status-banner');
const telemetryStatusText = document.getElementById('telemetry-status-text');

const telemetryTemp = document.getElementById('telemetry-temp');
const tempProgress = document.getElementById('temp-progress');
const telemetryFuel = document.getElementById('telemetry-fuel');
const fuelProgress = document.getElementById('fuel-progress');
const telemetryVibe = document.getElementById('telemetry-vibe');
const vibeProgress = document.getElementById('vibe-progress');
const telemetryPress = document.getElementById('telemetry-press');
const pressProgress = document.getElementById('press-progress');
const telemetryTime = document.getElementById('telemetry-time');

// Routing elements
const routeNodes = document.getElementById('route-nodes');
const routeDistance = document.getElementById('route-distance');
const routeEta = document.getElementById('route-eta');

// Chaos elements
const errorRateInput = document.getElementById('error-rate-input');
const errorRateVal = document.getElementById('error-rate-val');
const btnUpdateErrors = document.getElementById('btn-update-errors');

const latencyMsInput = document.getElementById('latency-ms-input');
const latencyMsVal = document.getElementById('latency-ms-val');
const btnUpdateLatency = document.getElementById('btn-update-latency');

const loadDuration = document.getElementById('load-duration');
const loadCores = document.getElementById('load-cores');
const btnTriggerLoad = document.getElementById('btn-trigger-load');

// Init application
document.addEventListener('DOMContentLoaded', () => {
    fetchCargoManifest();
    fetchErrorRate();
    fetchLatencyStatus();
    fetchLoadStatus();
    
    // Poll CPU load simulation status every 3 seconds
    loadStatusPollInterval = setInterval(fetchLoadStatus, 3000);
    
    // Form Event
    newCargoForm.addEventListener('submit', handleNewCargoSubmit);
    
    // Slider Visual Updates
    errorRateInput.addEventListener('input', (e) => {
        errorRateVal.innerText = `${e.target.value}%`;
    });
    
    latencyMsInput.addEventListener('input', (e) => {
        latencyMsVal.innerText = `${e.target.value} ms`;
    });
    
    // Action Events
    btnUpdateErrors.addEventListener('click', applyErrorRate);
    btnUpdateLatency.addEventListener('click', applyLatencyDelay);
    btnTriggerLoad.addEventListener('click', triggerCpuLoad);
});

// Update connection indicator
function setConnectedState(isConnected) {
    if (isConnected) {
        connectionStatus.innerHTML = '<span class="status-circle green"></span> Connected';
    } else {
        connectionStatus.innerHTML = '<span class="status-circle red"></span> Disconnected';
    }
}

// Fetch Cargo List
async function fetchCargoManifest() {
    try {
        const res = await fetch(CARGO_API);
        if (!res.ok) throw new Error('Failed to fetch cargo manifest');
        
        const cargoItems = await res.json();
        renderCargoList(cargoItems);
        metricTotalShipments.innerText = cargoItems.length;
        setConnectedState(true);
    } catch (err) {
        console.error('Error fetching cargo:', err);
        cargoList.innerHTML = `<div class="loader-placeholder" style="color: var(--color-red)">Failed to sync cargo. Ensure cargo-service is running.</div>`;
        setConnectedState(false);
    }
}

// Render Cargo List in Sidebar
function renderCargoList(items) {
    if (items.length === 0) {
        cargoList.innerHTML = '<div class="loader-placeholder">No cargo registered.</div>';
        return;
    }
    
    cargoList.innerHTML = '';
    items.forEach(item => {
        const li = document.createElement('li');
        li.className = `cargo-item ${selectedCargoId === item.id ? 'selected' : ''}`;
        li.dataset.id = item.id;
        
        li.innerHTML = `
            <div class="cargo-meta">
                <span class="cargo-id">${item.id}</span>
                <span class="cargo-name">${item.name}</span>
                <span class="cargo-dest">To: ${item.destination}</span>
            </div>
            <div class="cargo-stats">
                <span class="cargo-weight">${item.weight_kg} kg</span>
                <span class="cargo-status-badge">${item.status}</span>
            </div>
        `;
        
        li.addEventListener('click', () => selectCargoItem(item.id));
        cargoList.appendChild(li);
    });
}

// Select a Cargo Item
function selectCargoItem(cargoId) {
    selectedCargoId = cargoId;
    
    // Update active highlight classes
    document.querySelectorAll('.cargo-item').forEach(el => {
        if (el.dataset.id === cargoId) {
            el.classList.add('selected');
        } else {
            el.classList.remove('selected');
        }
    });
    
    // Clear existing interval
    if (telemetryPollInterval) clearInterval(telemetryPollInterval);
    
    // Fetch once immediately
    fetchCargoTelemetry(cargoId);
    
    // Start polling
    telemetryPollInterval = setInterval(() => fetchCargoTelemetry(cargoId), 2000);
}

// Fetch individual telemetry and routing
async function fetchCargoTelemetry(cargoId) {
    try {
        const res = await fetch(`${CARGO_API}/${cargoId}`);
        if (!res.ok) throw new Error('Telemetry/routing fetch error');
        
        const data = await res.json();
        displayTelemetryAndRouting(data);
    } catch (err) {
        console.error('Error fetching telemetry/routing:', err);
        // Display offline/error indicator in telemetry widget
        selectedCargoTitle.innerText = `Bridge Lost: ${cargoId}`;
        telemetryStatusBanner.className = "telemetry-status-banner red-glow";
        telemetryStatusText.innerText = "OFFLINE (HTTP 500 OR TIMEOUT INJECTED)";
        
        // Reset meters to 0
        updateProgress(tempProgress, 0);
        updateProgress(fuelProgress, 0);
        updateProgress(vibeProgress, 0);
        updateProgress(pressProgress, 0);
        
        telemetryTemp.innerText = '---';
        telemetryFuel.innerText = '---';
        telemetryVibe.innerText = '---';
        telemetryPress.innerText = '---';
        telemetryTime.innerText = 'Offline';
        
        // Clear routing path
        routeNodes.innerHTML = `<span style="color: var(--color-red); font-size: 0.75rem;">Navigation Telemetry Timeout (Istio Gateway Interruption)</span>`;
    }
}

// Render Telemetry & Go Routing values
function displayTelemetryAndRouting(data) {
    const cargo = data.cargo;
    const telemetry = data.telemetry;
    const routing = data.routing;
    
    noTelemetryFallback.style.display = 'none';
    telemetryDetails.style.display = 'block';
    
    selectedCargoTitle.innerText = `${cargo.name} (${cargo.id})`;
    
    // Handle Telemetry API failures
    if (telemetry.error) {
        telemetryStatusBanner.className = "telemetry-status-banner red-glow";
        telemetryStatusText.innerText = "BRIDGE ERROR: ORBITAL TELEMETRY OFFLINE";
        
        updateProgress(tempProgress, 0);
        updateProgress(fuelProgress, 0);
        updateProgress(vibeProgress, 0);
        updateProgress(pressProgress, 0);
        
        telemetryTemp.innerText = '---';
        telemetryFuel.innerText = '---';
        telemetryVibe.innerText = '---';
        telemetryPress.innerText = '---';
        telemetryTime.innerText = 'Offline';
    } else {
        // Status banner
        const status = telemetry.status.toUpperCase();
        telemetryStatusText.innerText = status;
        
        if (status === 'OPTIMAL') {
            telemetryStatusBanner.className = "telemetry-status-banner green-glow";
        } else if (status === 'WARNING') {
            telemetryStatusBanner.className = "telemetry-status-banner amber-glow";
        } else {
            telemetryStatusBanner.className = "telemetry-status-banner red-glow";
        }
        
        // Temp (scale: 0 - 40°C)
        const temp = telemetry.temperature_celsius;
        telemetryTemp.innerText = temp;
        const tempPercent = Math.min(100, Math.max(0, ((temp - 10) / 20) * 100)); // normalized scale
        updateProgress(tempProgress, tempPercent);
        
        // Fuel (0 - 100%)
        const fuel = telemetry.fuel_percentage;
        telemetryFuel.innerText = fuel;
        updateProgress(fuelProgress, fuel);
        
        // Vibration (scale: 0 - 5G)
        const vibe = telemetry.vibration_g;
        telemetryVibe.innerText = vibe;
        const vibePercent = Math.min(100, (vibe / 5.0) * 100);
        updateProgress(vibeProgress, vibePercent);
        
        // Pressure (scale: 90 - 110 kPa)
        const press = telemetry.atmospheric_pressure_kpa;
        telemetryPress.innerText = press;
        const pressPercent = Math.min(100, Math.max(0, ((press - 90) / 20) * 100));
        updateProgress(pressProgress, pressPercent);
        
        // Time
        const date = new Date(telemetry.timestamp * 1000);
        telemetryTime.innerText = date.toLocaleTimeString();
    }
    
    // Handle Go Routing API values or failures (like injected delay timeout)
    if (!routing || routing.error) {
        routeNodes.innerHTML = `
            <div style="color: var(--color-red); font-size: 0.75rem; text-align: center; width: 100%;">
                ⚠️ NAVIGATION TIMEOUT: ${routing?.error || 'Service Unreachable'}
            </div>
        `;
        routeDistance.innerText = '0.00 M km';
        routeEta.innerText = 'N/A';
    } else {
        routeDistance.innerText = `${routing.distance_million_km} M km`;
        routeEta.innerText = routing.eta;
        
        // Render Waypoints
        routeNodes.innerHTML = '';
        const waypoints = routing.waypoints || [];
        waypoints.forEach((wp, idx) => {
            const nodeDiv = document.createElement('div');
            // Standard pathing: all previous nodes completed, final node active
            let stateClass = '';
            if (idx === waypoints.length - 1) {
                stateClass = 'active';
            } else {
                stateClass = 'completed';
            }
            
            nodeDiv.className = `route-node ${stateClass}`;
            nodeDiv.innerHTML = `
                <div class="node-dot"></div>
                <span class="node-label" title="${wp}">${wp}</span>
            `;
            routeNodes.appendChild(nodeDiv);
        });
    }
}

function updateProgress(element, percentage) {
    element.style.width = `${percentage}%`;
    if (percentage > 90) {
        element.style.backgroundColor = 'var(--color-red)';
    } else if (percentage > 70) {
        element.style.backgroundColor = 'var(--color-amber)';
    } else {
        element.style.backgroundColor = 'var(--color-blue)';
    }
}

// Handle Form Submit
async function handleNewCargoSubmit(e) {
    e.preventDefault();
    
    const payload = {
        name: cargoNameInput.value,
        destination: cargoDestinationInput.value,
        weight_kg: parseFloat(cargoWeightInput.value)
    };
    
    try {
        const res = await fetch(CARGO_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (!res.ok) throw new Error('Create cargo request failed');
        
        const newCargo = await res.json();
        
        // Refresh manifest list and auto-select new item
        await fetchCargoManifest();
        selectCargoItem(newCargo.id);
        
        // Reset form inputs
        newCargoForm.reset();
    } catch (err) {
        console.error('Error creating cargo:', err);
        alert('Failed to register cargo. Check connections.');
    }
}

// Fetch Error rate from backend
async function fetchErrorRate() {
    try {
        const res = await fetch(`${CARGO_API}/error-rate`);
        if (res.ok) {
            const data = await res.json();
            const ratePercent = Math.round(data.error_rate * 100);
            errorRateInput.value = ratePercent;
            errorRateVal.innerText = `${ratePercent}%`;
            metricErrorRate.innerText = `${ratePercent}%`;
        }
    } catch (err) {
        console.error('Could not fetch error rate:', err);
    }
}

// Apply error rate to cargo service
async function applyErrorRate() {
    const rate = parseInt(errorRateInput.value) / 100.0;
    try {
        const res = await fetch(`${CARGO_API}/simulate-errors`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rate })
        });
        
        if (res.ok) {
            alert(`Backend failure rate updated to ${rate * 100}%`);
            metricErrorRate.innerText = `${rate * 100}%`;
        } else {
            alert('Failed to apply failure rate configuration.');
        }
    } catch (err) {
        console.error('Error updating error rate:', err);
    }
}

// Fetch Latency settings from backend
async function fetchLatencyStatus() {
    try {
        const res = await fetch(`${CARGO_API}/latency-status`);
        if (res.ok) {
            const data = await res.json();
            const latency = data.latency_ms || 0;
            latencyMsInput.value = latency;
            latencyMsVal.innerText = `${latency} ms`;
        }
    } catch (err) {
        console.error('Could not fetch latency rate:', err);
    }
}

// Apply latency configurations to Go Routing Service
async function applyLatencyDelay() {
    const latencyVal = parseInt(latencyMsInput.value);
    try {
        const res = await fetch(`${CARGO_API}/simulate-latency`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ latency_ms: latencyVal })
        });
        
        if (res.ok) {
            alert(`Go service routing delay updated to ${latencyVal} ms.\nRequests to route calculation will be delayed by this value.`);
        } else {
            alert('Failed to apply latency configuration.');
        }
    } catch (err) {
        console.error('Error updating latency configuration:', err);
    }
}

// Fetch CPU load status from telemetry service
async function fetchLoadStatus() {
    try {
        const res = await fetch(`${TELEMETRY_API}/load-status`);
        if (res.ok) {
            const data = await res.json();
            const threads = data.active_simulation_threads;
            metricCpuLoad.innerText = threads;
            
            if (threads > 0) {
                metricHpaCard.classList.add('burning');
            } else {
                metricHpaCard.classList.remove('burning');
            }
        }
    } catch (err) {
        console.error('Could not fetch load status:', err);
    }
}

// Trigger CPU burner load
async function triggerCpuLoad() {
    const duration = parseInt(loadDuration.value);
    const cores = parseInt(loadCores.value);
    
    try {
        const res = await fetch(`${TELEMETRY_API}/simulate-load`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                duration_seconds: duration,
                cores: cores
            })
        });
        
        if (res.ok) {
            const data = await res.json();
            alert(`CPU load thread simulation dispatched on telemetry node!\nWatch HPA pods auto-scale.\nActive Load Threads: ${data.active_simulations}`);
            fetchLoadStatus();
        } else {
            alert('Load generator endpoint failed.');
        }
    } catch (err) {
        console.error('Error triggering CPU load:', err);
    }
}
