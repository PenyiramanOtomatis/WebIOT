// ===============================
// MONITORING DASHBOARD — TEST MODE (1 SENSOR)
// ===============================

import { checkAuth, logout, getUserEmail, getUserName, getUserRole } from './auth.js';
import { rtdb } from './firebase-config.js';
import {
  ref,
  onValue,
  set
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

// ===============================
// GLOBAL VARIABLES
// ===============================
let moistureData  = [];
let chart         = null;
let timeRange     = 'minute';
let currentMode   = 'otomatis';
let pumpStatus    = 'OFF';

const THRESHOLD_KERING = 40;

// ===============================
// INITIALIZE APP
// ===============================
document.addEventListener('DOMContentLoaded', () => {
  checkAuth((user, userData) => {
    console.log('User authenticated:', userData);
    initializeDashboard(userData);
  });
});

// ===============================
// INITIALIZE DASHBOARD
// ===============================
function initializeDashboard(userData) {

  displayUserInfo(userData);

  const userRole = userData.role || getUserRole();

  if (userRole !== 'admin') {
    const exportBtn = document.querySelector('.export-btn');
    if (exportBtn) exportBtn.style.display = 'none';
  }

  if (userRole !== 'admin') {
    const modeControlCard = document.getElementById('modeControlCard');
    if (modeControlCard) modeControlCard.style.display = 'none';
  }

  // Sembunyikan sensor 2 & 3 di UI — hanya 1 sensor aktif
  hideSensor2And3();

  initializeChart();
  startRealtimeListeners();

  console.log('✅ Dashboard TEST aktif | Role:', userRole);
}

// ===============================
// SEMBUNYIKAN SENSOR 2 & 3
// ===============================
function hideSensor2And3() {
  // Sembunyikan card sensor 2 dan 3, ganti label sensor 1
  const s2Card = document.querySelector('#sensor2Value')?.closest('.sensor-card');
  const s3Card = document.querySelector('#sensor3Value')?.closest('.sensor-card');

  if (s2Card) s2Card.style.display = 'none';
  if (s3Card) s3Card.style.display = 'none';

  // Ganti label sensor 1 → "Sensor Aktif (Pin 4)"
  const s1Label = document.querySelector('#sensor1Value')?.closest('.sensor-card')?.querySelector('.sensor-label');
  if (s1Label) s1Label.textContent = '🌡️ Sensor Aktif (Pin 4)';

  // Ganti label rata-rata
  const avgLabel = document.querySelector('.value-label');
  if (avgLabel) avgLabel.textContent = 'Kelembaban Terbaca';
}

// ===============================
// DISPLAY USER INFO
// ===============================
function displayUserInfo(userData) {
  const emailEl = document.getElementById('userEmail');
  const roleEl  = document.getElementById('userRole');

  if (emailEl) emailEl.textContent = userData.email || getUserEmail();
  if (roleEl)  roleEl.textContent  = (userData.role || getUserRole()) === 'admin'
    ? 'Administrator'
    : 'User';
}

// ===============================
// REALTIME LISTENERS
// ===============================
function startRealtimeListeners() {

  // ------------------------------------------
  // 1. LISTENER DATA SENSOR (/soil)
  // ------------------------------------------
  onValue(ref(rtdb, '/soil'), (snapshot) => {

    const data = snapshot.val();

    if (!data) {
      setDefaultValues();
      return;
    }

    // Hanya pakai nilai sensor3 (Pin 4) sebagai nilai utama
    // Tapi karena ESP32 menyamakan sensor1=sensor2=sensor3=moisture,
    // kita cukup pakai average
    const moisture = parseFloat(data.average || 0);

    // Tampilkan hanya sensor 1 (yang aktif) dan average
    document.getElementById('sensor1Value').textContent = moisture.toFixed(2) + '%';
    document.getElementById('sensor2Value').textContent = moisture.toFixed(2) + '%';
    document.getElementById('sensor3Value').textContent = moisture.toFixed(2) + '%';
    document.getElementById('averageValue').textContent = moisture.toFixed(2) + '%';

    updateMoistureAlert(moisture);

    moistureData.push({
      timestamp: new Date(),
      sensor1:   moisture,
      sensor2:   moisture,
      sensor3:   moisture,
      moisture:  moisture,
      pumpStatus: pumpStatus,
      mode:      currentMode
    });

    if (moistureData.length > 200) moistureData.shift();

    updateChart();
    updateTable();

  }, (error) => {
    console.error('Sensor listener error:', error);
    setDefaultValues();
  });

  // ------------------------------------------
  // 2. LISTENER STATUS POMPA (/pump/status)
  // ------------------------------------------
  onValue(ref(rtdb, '/pump/status'), (snapshot) => {

    const val = snapshot.val();
    pumpStatus = (val === 1 || val === '1') ? 'ON' : 'OFF';
    updatePumpDisplay();

  }, (error) => {
    console.error('Pump status listener error:', error);
  });

  // ------------------------------------------
  // 3. LISTENER MODE (/control/mode)
  // ------------------------------------------
  onValue(ref(rtdb, '/control/mode'), (snapshot) => {

    const val = snapshot.val() || 'auto';
    currentMode = (val === 'auto') ? 'otomatis' : 'manual';
    updateModeDisplay();

  }, (error) => {
    console.error('Mode listener error:', error);
  });
}

// ===============================
// UPDATE PUMP DISPLAY
// ===============================
function updatePumpDisplay() {

  const statusDisplay = document.getElementById('pumpStatusDisplay');
  const indicator     = document.getElementById('pumpIndicator');

  if (!statusDisplay || !indicator) return;

  if (pumpStatus === 'ON') {
    statusDisplay.textContent = 'ON';
    statusDisplay.className   = 'status-value on';
    indicator.className       = 'status-indicator online';
    indicator.innerHTML       = '<div class="status-dot online"></div><span>Pompa Aktif</span>';
  } else {
    statusDisplay.textContent = 'OFF';
    statusDisplay.className   = 'status-value off';
    indicator.className       = 'status-indicator offline';
    indicator.innerHTML       = '<div class="status-dot offline"></div><span>Pompa Mati</span>';
  }
}

// ===============================
// UPDATE MODE DISPLAY
// ===============================
function updateModeDisplay() {

  const isManual = (currentMode === 'manual');
  const label    = isManual ? 'Manual' : 'Otomatis';

  const modeDisplay   = document.getElementById('modeDisplay');
  const modeIndicator = document.getElementById('modeIndicator');
  const modeDesc      = document.getElementById('modeDescription');
  const manualPanel   = document.getElementById('manualControlPanel');
  const autoBtn       = document.getElementById('autoModeBtn');
  const manualBtn     = document.getElementById('manualModeBtn');

  if (modeDisplay) modeDisplay.textContent = label;

  if (modeIndicator) {
    modeIndicator.className = 'status-indicator ' + (isManual ? 'info' : 'online');
    modeIndicator.innerHTML = `<div class="status-dot online"></div>
      <span>Mode ${label} Aktif</span>`;
  }

  if (modeDesc) {
    if (isManual) {
      modeDesc.className = 'alert warning';
      modeDesc.innerHTML = '<span>⚠️</span><span><strong>Mode Manual:</strong> Sensor diabaikan — kontrol pompa dari tombol</span>';
    } else {
      modeDesc.className = 'alert success';
      modeDesc.innerHTML = '<span>⚡</span><span><strong>Mode Otomatis:</strong> Relay ON jika kelembaban &lt; 40%, OFF jika ≥ 40%</span>';
    }
  }

  if (manualPanel) manualPanel.style.display = isManual ? 'block' : 'none';

  if (autoBtn)   autoBtn.classList.toggle('active', !isManual);
  if (manualBtn) manualBtn.classList.toggle('active', isManual);

  // Read-only di kartu status pompa
  const modeRODisplay   = document.getElementById('modeDisplayReadOnly');
  const modeROIndicator = document.getElementById('modeIndicatorReadOnly');

  if (modeRODisplay) modeRODisplay.textContent = label;

  if (modeROIndicator) {
    modeROIndicator.className = 'status-indicator ' + (isManual ? 'info' : 'online');
    modeROIndicator.innerHTML = `<div class="status-dot online"></div>
      <span>Mode ${label} Aktif</span>`;
  }
}

// ===============================
// UPDATE MOISTURE ALERT
// ===============================
function updateMoistureAlert(moisture) {

  const alertDiv = document.getElementById('moistureAlert');
  if (!alertDiv) return;

  if (moisture < THRESHOLD_KERING) {
    alertDiv.className = 'alert danger';
    alertDiv.innerHTML = '<span>🔴</span><span><strong>KERING! (< 40%)</strong> — Relay aktif otomatis (Mode Auto)</span>';
  } else if (moisture > 70) {
    alertDiv.className = 'alert warning';
    alertDiv.innerHTML = '<span>💧</span><span><strong>Terlalu Basah! (> 70%)</strong> — Relay mati otomatis</span>';
  } else {
    alertDiv.className = 'alert success';
    alertDiv.innerHTML = '<span>🟢</span><span><strong>Lembab Normal (40–70%)</strong> — Kelembaban optimal</span>';
  }
}

// ===============================
// SET DEFAULT VALUES
// ===============================
function setDefaultValues() {
  ['sensor1Value', 'sensor2Value', 'sensor3Value', 'averageValue']
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = '0%';
    });
}

// ===============================
// SET MODE (dipanggil dari tombol HTML)
// ===============================
window.setMode = async function(mode) {

  if (getUserRole() !== 'admin') {
    alert('⚠️ Hanya Admin yang dapat mengubah mode!');
    return;
  }

  try {
    // Web kirim 'otomatis' → Firebase simpan 'auto' (agar ESP32 bisa baca)
    // Web kirim 'manual'   → Firebase simpan 'manual'
    const firebaseMode = (mode === 'otomatis') ? 'auto' : 'manual';

    await set(ref(rtdb, '/control/mode'), firebaseMode);

    // Jika beralih ke auto, reset perintah pompa ke 0 (safety)
    if (firebaseMode === 'auto') {
      await set(ref(rtdb, '/control/pump'), 0);
      console.log('✅ Mode → auto | PumpCmd direset ke 0');
    } else {
      console.log('✅ Mode → manual');
    }

  } catch (error) {
    console.error('setMode error:', error);
    alert('Gagal mengubah mode: ' + error.message);
  }
}

// ===============================
// CONTROL PUMP (dipanggil dari tombol HTML)
// ===============================
window.controlPump = async function(status) {

  if (currentMode !== 'manual') {
    alert('⚠️ Ubah ke Mode Manual dulu sebelum kontrol pompa!');
    return;
  }

  if (getUserRole() !== 'admin') {
    alert('⚠️ Hanya Admin yang dapat mengontrol pompa!');
    return;
  }

  try {
    const pumpValue = (status === 'ON') ? 1 : 0;

    await set(ref(rtdb, '/control/pump'), pumpValue);

    console.log(`✅ Perintah pompa dikirim: ${status} (${pumpValue})`);
    console.log('   Sensor diabaikan — pompa langsung ' + status);

  } catch (error) {
    console.error('controlPump error:', error);
    alert('Gagal mengontrol pompa: ' + error.message);
  }
}

// ===============================
// INITIALIZE CHART
// ===============================
function initializeChart() {

  const ctx = document.getElementById('moistureChart');
  if (!ctx) return;

  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Kelembaban (Sensor Pin 4)',
          data: [],
          borderColor: '#007bff',
          backgroundColor: 'rgba(0,123,255,0.1)',
          tension: 0.4,
          pointRadius: 4,
          borderWidth: 2
        },
        {
          // Garis threshold kering
          label: 'Batas Kering (40%)',
          data: [],
          borderColor: '#dc3545',
          borderDash: [6, 4],
          backgroundColor: 'transparent',
          pointRadius: 0,
          borderWidth: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: true, position: 'top' },
        tooltip: { mode: 'index', intersect: false }
      },
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
          title: { display: true, text: 'Kelembaban (%)' }
        },
        x: {
          title: { display: true, text: 'Waktu' }
        }
      }
    }
  });
}

// ===============================
// UPDATE CHART
// ===============================
function updateChart() {

  if (!chart) return;

  const displayData = getDataByTimeRange();

  chart.data.labels            = displayData.map(d => formatTime(d.timestamp));
  chart.data.datasets[0].data  = displayData.map(d => d.moisture);

  // Garis putus-putus threshold 40% sepanjang chart
  chart.data.datasets[1].data  = displayData.map(() => THRESHOLD_KERING);

  chart.update('none');
}

// ===============================
// GET DATA BY TIME RANGE
// ===============================
function getDataByTimeRange() {

  const now = Date.now();

  const ranges = {
    minute: 3600000,
    hour:   86400000,
    day:    2592000000,
    week:   7776000000
  };

  const limit = ranges[timeRange] || ranges.minute;
  return moistureData.filter(d => (now - d.timestamp.getTime()) < limit);
}

// ===============================
// CHANGE TIME RANGE (dari tombol HTML)
// ===============================
window.changeTimeRange = function(range) {

  timeRange = range;

  document.querySelectorAll('.time-btn').forEach(btn => btn.classList.remove('active'));

  document.querySelectorAll('.time-btn').forEach(btn => {
    if (btn.getAttribute('onclick')?.includes(range)) {
      btn.classList.add('active');
    }
  });

  const labels = {
    minute: 'per menit (1 jam terakhir)',
    hour:   'per jam (24 jam terakhir)',
    day:    'per hari (30 hari terakhir)',
    week:   'per minggu (3 bulan terakhir)'
  };

  const infoEl = document.getElementById('chartInfoText');
  if (infoEl) infoEl.textContent = 'Menampilkan data ' + (labels[range] || '');

  updateChart();
}

// ===============================
// UPDATE TABLE
// ===============================
function updateTable() {

  const tbody = document.getElementById('tableBody');
  if (!tbody) return;

  tbody.innerHTML = '';

  if (moistureData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px;color:#6c757d;">Belum ada data</td></tr>';
    return;
  }

  const recentData = [...moistureData].reverse().slice(0, 30);

  recentData.forEach(data => {
    const row = tbody.insertRow();

    row.insertCell(0).textContent = formatDateTime(data.timestamp);

    // Kolom sensor 2 & 3 ditampilkan tapi dengan keterangan
    const s1Cell = row.insertCell(1);
    s1Cell.textContent = data.moisture.toFixed(2) + '%';
    s1Cell.style.fontWeight = 'bold';

    const s2Cell = row.insertCell(2);
    s2Cell.textContent = '—';
    s2Cell.style.color = '#aaa';

    const s3Cell = row.insertCell(3);
    s3Cell.textContent = '—';
    s3Cell.style.color = '#aaa';

    row.insertCell(4).textContent = data.moisture.toFixed(2) + '%';

    const pumpCell = row.insertCell(5);
    pumpCell.textContent  = data.pumpStatus;
    pumpCell.style.fontWeight = 'bold';
    pumpCell.style.color  = data.pumpStatus === 'ON' ? '#28a745' : '#dc3545';

    row.insertCell(6).textContent = data.mode === 'otomatis' ? 'Otomatis' : 'Manual';
  });
}

// ===============================
// EXPORT TO EXCEL
// ===============================
window.exportToExcel = function() {

  if (getUserRole() !== 'admin') {
    alert('⚠️ Hanya Admin yang dapat export data!');
    return;
  }

  const ws_data = [['Waktu', 'Kelembaban (%)', 'Status Pompa', 'Mode']];

  [...moistureData].reverse().slice(0, 100).forEach(d => {
    ws_data.push([
      formatDateTime(d.timestamp),
      d.moisture,
      d.pumpStatus,
      d.mode === 'otomatis' ? 'Otomatis' : 'Manual'
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(ws_data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Data Kelembaban Test');
  XLSX.writeFile(wb, 'test_kelembaban_' + new Date().toISOString().split('T')[0] + '.xlsx');
}

// ===============================
// LOGOUT
// ===============================
window.handleLogout = async function() {
  if (confirm('Yakin ingin logout?')) {
    try {
      await logout();
    } catch (error) {
      alert('Gagal logout: ' + error.message);
    }
  }
}

// ===============================
// HELPER FUNCTIONS
// ===============================
function formatTime(date) {
  if (!date) return '--';
  return date.toLocaleTimeString('id-ID');
}

function formatDateTime(date) {
  if (!date) return '--';
  return date.toLocaleString('id-ID');
}