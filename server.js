const express = require("express");
const WebSocket = require("ws");
const path = require("path");
const http = require("http");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

/* ================= PATIENT DATA ================= */

let patientData = {
  id: "AMB-001",
  name: "Somil Jain",
  age: 20,
  gender: "Male",
  bloodType: "O+",
  disease: "Acute Myocardial Infarction (Heart Attack)",
  symptoms: "Chest pain, shortness of breath, sweating",
  medications: ["Aspirin", "Clopidogrel", "Nitroglycerin"],
  allergies: "Penicillin",
  emergencyContact: "+1 (555) 123-4567",
  vitals: {
    hr: 0,
    spo2: 0,
    timestamp: new Date()
  },
  vitalsHistory: []
};

/* ================= CONNECTION STATE ================= */

let clients = new Set();        // Browsers
let esp32Connected = null;      // Sensor
let sensorStatus = {
  connected: false,
  lastUpdate: null
};

/* ================= WEBSOCKET ================= */

wss.on("connection", (ws, req) => {
  console.log(" New WebSocket Connection");

  let isSensor = false;

  // Assume browser first, confirm sensor via data
  clients.add(ws);

  ws.send(JSON.stringify({
    type: "sensor_status",
    connected: sensorStatus.connected,
    message: sensorStatus.connected
      ? "Sensor connected"
      : "Waiting for sensor..."
  }));

  ws.on("message", (message) => {
    const data = message.toString();
    console.log(" RAW MESSAGE:", data);

    try {
      const parsed = JSON.parse(data);

      /* ================= SENSOR DATA ================= */

      if (parsed.hr !== undefined && parsed.spo2 !== undefined) {

        // Identify as sensor
        if (!isSensor) {
          isSensor = true;

          // Remove from browser clients
          clients.delete(ws);

          // Replace old sensor if exists
          if (esp32Connected && esp32Connected !== ws) {
            try { esp32Connected.close(); } catch { }
          }

          esp32Connected = ws;

          sensorStatus.connected = true;
          sensorStatus.lastUpdate = new Date();

          console.log("ESP32 Sensor Connected ");

          broadcastToClients({
            type: "sensor_status",
            connected: true,
            message: "Sensor connected"
          });
        }

        /* ================= UPDATE VITALS ================= */

        patientData.vitals = {
          hr: parsed.hr,
          spo2: parsed.spo2,
          timestamp: new Date()
        };

        sensorStatus.lastUpdate = new Date();

        patientData.vitalsHistory.push({
          hr: parsed.hr,
          spo2: parsed.spo2,
          timestamp: new Date()
        });

        if (patientData.vitalsHistory.length > 100) {
          patientData.vitalsHistory.shift();
        }

        console.log(` HR: ${parsed.hr} bpm | SpO2: ${parsed.spo2}%`);

        broadcastToClients({
          type: "vitals",
          hr: parsed.hr,
          spo2: parsed.spo2,
          timestamp: new Date()
        });
      }

    } catch (err) {
      console.log(" Invalid JSON:", data);
    }
  });

  ws.on("close", () => {
    if (isSensor) {
      console.log(" Sensor Disconnected ");

      sensorStatus.connected = false;
      esp32Connected = null;

      broadcastToClients({
        type: "sensor_status",
        connected: false,
        message: "Sensor disconnected"
      });

    } else {
      clients.delete(ws);
      console.log(" Browser Disconnected ");
    }
  });

  ws.on("error", (err) => {
    console.error("WebSocket Error:", err.message);
  });
});

/* ================= SENSOR TIMEOUT (CRITICAL FIX) ================= */

setInterval(() => {
  if (sensorStatus.lastUpdate) {
    const diff = Date.now() - new Date(sensorStatus.lastUpdate).getTime();

    if (diff > 5000 && sensorStatus.connected) {
      console.log(" Sensor Timeout ");

      sensorStatus.connected = false;
      esp32Connected = null;

      broadcastToClients({
        type: "sensor_status",
        connected: false,
        message: "Sensor timeout - no data"
      });
    }
  }
}, 2000);

/* ================= BROADCAST ================= */

function broadcastToClients(message) {
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
}

/* ================= REST API ================= */

app.get("/api/patient", (req, res) => {
  res.json({
    ...patientData,
    sensorStatus
  });
});

app.get("/api/vitals/history", (req, res) => {
  res.json(patientData.vitalsHistory);
});

app.get("/api/sensor/status", (req, res) => {
  res.json(sensorStatus);
});

/* ================= SERVER ================= */

server.listen(3000, () => {
  console.log(" Ambulance Server Running → http://localhost:3000");
  console.log(" WebSocket Running → ws://localhost:3000");
});