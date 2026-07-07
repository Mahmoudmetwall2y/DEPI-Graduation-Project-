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

// Chaos elements
const errorRateInput = document.getElementById('error-rate-input');
const errorRateVal = document.getElementById('error-rate-val');
const btnUpdateErrors = document.getElementById('btn-update-errors');
const loadDuration = document.getElementById('load-duration');
const loadCores = document.getElementById('load-cores');
const btnTriggerLoad = document.getElementById('btn-trigger-load');

// Init application
document.addEventListener('DOMContentLoaded', () => {
    fetchCargoManifest();
    fetchErrorRate();
    fetchLoadStatus();
    
    // Poll CPU load simulation status every 3 seconds
    loadStatusPollInterval = setInterval(fetchLoadStatus, 3000);
    
    // Form Event
    newCargoForm.addEventListener('submit', handleNewCargoSubmit);
    
    // Slider Visual Update
    errorRateInput.addEventListener('input', (e) => {
        errorRateVal.innerText = `${e.target.value}%`;
    });
    
    // Action Events
    btnUpdateErrors.addEventListener('click', applyErrorRate);
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

// Fetch individual telemetry
async function fetchCargoTelemetry(cargoId) {
    try {
        const res = await fetch(`${CARGO_API}/${cargoId}`);
        if (!res.ok) throw new Error('Telemetry fetch error');
        
        const data = await res.json();
        displayTelemetry(data);
    } catch (err) {
        console.error('Error fetching telemetry:', err);
        // Display offline/error indicator in telemetry widget
        selectedCargoTitle.innerText = `Bridge Lost: ${cargoId}`;
        telemetryStatusBanner.className = "telemetry-status-banner red-glow";
        telemetryStatusText.innerText = "OFFLINE (HTTP 500 INJECTED OR DOWN)";
    }
}

// Render Telemetry values
function displayTelemetry(data) {
    const cargo = data.cargo;
    const telemetry = data.telemetry;
    
    noTelemetryFallback.style.display = 'none';
    telemetryDetails.style.display = 'block';
    
    selectedCargoTitle.innerText = `${cargo.name} (${cargo.id})`;
    
    if (telemetry.error) {
        telemetryStatusBanner.className = "telemetry-status-banner red-glow";
        telemetryStatusText.innerText = "BRIDGE ERROR: ORBITAL TELEMETRY OFFLINE";
        
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
        return;
    }
    
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
