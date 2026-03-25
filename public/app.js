// ================= WebSocket =================

let ws = null;
let vitalsData = [];
let chartHR = null;
let chartSpO2 = null;
let sensorConnected = false;

// ================= Initialize =================

document.addEventListener('DOMContentLoaded', () => {
    initializeWebSocket();
    loadPatientData();
    setupCharts();
    updateTimestamp();
    setInterval(updateTimestamp, 1000);
});

// ================= WebSocket Connection =================

function initializeWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('✅ Connected to server');
        updateConnectionStatus(true);
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);

            if (data.type === 'vitals') {
                updateVitals(data);
            }
            else if (data.type === 'sensor_status') {
                handleSensorStatus(data);
            }

        } catch (err) {
            console.error('Error parsing message:', err);
        }
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        updateConnectionStatus(false);
        addAlert('Connection Error', 'Lost connection to server', 'danger');
    };

    ws.onclose = () => {
        console.log('❌ Disconnected from server');

        updateConnectionStatus(false);

        sensorConnected = false;
        updateSensorStatus();          // ⭐ Important fix
        updateSensorIndicator();

        addAlert('Disconnected', 'Attempting to reconnect...', 'warning');

        setTimeout(initializeWebSocket, 3000);
    };
}

// ================= Sensor Status =================

function handleSensorStatus(data) {
    sensorConnected = data.connected;

    updateSensorStatus();
    updateSensorIndicator();

    if (data.connected) {
        addAlert('🚑 Sensor Connected', data.message, 'success');
    } else {
        addAlert('📡 Sensor Offline', data.message, 'warning');
    }
}

// ================= Load Patient Data =================

function loadPatientData() {
    fetch('/api/patient')
        .then(res => res.json())
        .then(data => {
            displayPatientInfo(data);

            if (data.sensorStatus) {
                sensorConnected = data.sensorStatus.connected;
                updateSensorStatus();
                updateSensorIndicator();
            }

            if (data.vitalsHistory && data.vitalsHistory.length > 0) {
                vitalsData = data.vitalsHistory;
                updateCharts();
                updateStatistics();
            }
        })
        .catch(err => console.error('Error loading patient data:', err));
}

// ================= Display Patient Info =================

function displayPatientInfo(patient) {
    document.getElementById('patientId').textContent = patient.id;
    document.getElementById('patientName').textContent = patient.name;
    document.getElementById('patientAge').textContent = patient.age + ' years';
    document.getElementById('patientGender').textContent = patient.gender;
    document.getElementById('patientBlood').textContent = patient.bloodType;
    document.getElementById('patientDisease').textContent = patient.disease;
    document.getElementById('patientSymptoms').textContent = patient.symptoms || 'None reported';
    document.getElementById('patientMeds').textContent = patient.medications.join(', ') || 'None';
    document.getElementById('patientAllergies').textContent = patient.allergies || 'None known';
    document.getElementById('patientContact').textContent = patient.emergencyContact;
}

// ================= Update Vitals =================

function updateVitals(data) {
    const hr = data.hr;
    const spo2 = data.spo2;
    const timestamp = new Date(data.timestamp);

    vitalsData.push({ hr, spo2, timestamp });

    if (vitalsData.length > 100) vitalsData.shift();

    document.getElementById('hrValue').textContent = hr;
    document.getElementById('spo2Value').textContent = spo2;

    document.getElementById('hrLastUpdate').textContent =
        `Last update: ${timestamp.toLocaleTimeString()}`;

    document.getElementById('spo2LastUpdate').textContent =
        `Last update: ${timestamp.toLocaleTimeString()}`;

    updateVitalStatus(hr, spo2);
    updateBar('hrBar', hr, 40, 180);
    updateBar('spo2Bar', spo2, 85, 100);

    updateCharts();
    updateStatistics();
    checkAlerts(hr, spo2);
}

// ================= Vital Status =================

function updateVitalStatus(hr, spo2) {
    const hrStatus = document.getElementById('hrStatus');

    if (hr < 60) {
        hrStatus.textContent = 'BRADYCARDIA';
        hrStatus.className = 'vital-status warning';
    }
    else if (hr > 100) {
        hrStatus.textContent = 'TACHYCARDIA';
        hrStatus.className = 'vital-status danger';
    }
    else {
        hrStatus.textContent = 'NORMAL';
        hrStatus.className = 'vital-status';
    }

    const spo2Status = document.getElementById('spo2Status');

    if (spo2 < 95) {
        spo2Status.textContent = 'LOW';
        spo2Status.className = 'vital-status danger';
    }
    else if (spo2 < 98) {
        spo2Status.textContent = 'MONITOR';
        spo2Status.className = 'vital-status warning';
    }
    else {
        spo2Status.textContent = 'NORMAL';
        spo2Status.className = 'vital-status';
    }
}

// ================= Bars =================

function updateBar(elementId, value, min, max) {
    const bar = document.getElementById(elementId);
    const percentage = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
    bar.style.width = percentage + '%';
}

// ================= Charts =================

function setupCharts() {
    const ctxHR = document.getElementById('heartRateChart').getContext('2d');
    chartHR = new Chart(ctxHR, {
        type: 'line',
        data: { labels: [], datasets: [{ label: 'Heart Rate', data: [] }] }
    });

    const ctxSpO2 = document.getElementById('spo2Chart').getContext('2d');
    chartSpO2 = new Chart(ctxSpO2, {
        type: 'line',
        data: { labels: [], datasets: [{ label: 'SpO2', data: [] }] }
    });
}

function updateCharts() {
    if (!chartHR || !chartSpO2) return;

    chartHR.data.labels = vitalsData.map(d => new Date(d.timestamp).toLocaleTimeString());
    chartHR.data.datasets[0].data = vitalsData.map(d => d.hr);
    chartHR.update('none');

    chartSpO2.data.labels = chartHR.data.labels;
    chartSpO2.data.datasets[0].data = vitalsData.map(d => d.spo2);
    chartSpO2.update('none');
}

// ================= Statistics =================

function updateStatistics() {
    if (vitalsData.length === 0) return;

    const hrs = vitalsData.map(d => d.hr);
    const spo2s = vitalsData.map(d => d.spo2);

    document.getElementById('avgHR').textContent =
        Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) + ' bpm';

    document.getElementById('avgSpo2').textContent =
        Math.round(spo2s.reduce((a, b) => a + b, 0) / spo2s.length) + ' %';
}

// ================= UI Status =================

function updateConnectionStatus(connected) {
    const status = document.getElementById('connectionStatus');

    if (connected) {
        status.textContent = '● Connected';
        status.className = 'status connected';
    } else {
        status.textContent = '● Disconnected';
        status.className = 'status disconnected';
    }
}

function updateSensorStatus() {
    const sensorStatus = document.getElementById('sensorStatus');

    if (sensorConnected) {
        sensorStatus.textContent = '📡 Sensor: Online';
        sensorStatus.className = 'status connected';
    } else {
        sensorStatus.textContent = '📡 Sensor: Offline';
        sensorStatus.className = 'status disconnected';
    }
}

function updateSensorIndicator() {
    const hrCard = document.querySelector('.vital-card.heart-rate');
    const spo2Card = document.querySelector('.vital-card.spo2');

    if (!sensorConnected) {
        if (hrCard) hrCard.style.opacity = '0.6';
        if (spo2Card) spo2Card.style.opacity = '0.6';
    } else {
        if (hrCard) hrCard.style.opacity = '1';
        if (spo2Card) spo2Card.style.opacity = '1';
    }
}

// ================= Alerts =================

function addAlert(title, message, type = 'info') {
    console.log(`[${type.toUpperCase()}] ${title}: ${message}`);
}

// ================= Timestamp =================

function updateTimestamp() {
    document.getElementById('timestamp').textContent =
        new Date().toLocaleString();
}