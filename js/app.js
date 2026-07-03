// ===============================
// MONITORING DASHBOARD — 2 SENSOR
// ===============================

import { checkAuth, logout, getUserEmail, getUserName, getUserRole } from './auth.js';
import { rtdb } from './firebase-config.js';
import {
  ref,
  onValue,
  set,
  get          // ← tambahan: untuk baca nilai satu kali
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

// ===============================
// GLOBAL VARIABLES
// ===============================
let moistureData  = [];
let chart         = null;
let timeRange     = 'minute';

// FIX: currentMode sinkron langsung dari Firebase, bukan dari inisialisasi lokal
let currentMode   = null;   // null = belum diketahui (tunggu Firebase)
let pumpStatus    = 'OFF';


let lastUpdateValue    = null;
let lastUpdateReceived = null;
let offlineCheckTimer  = null;
const OFFLINE_TIMEOUT_MS = 300000; // 5 menit tidak update → anggap offline
let isOnline = false; // default offline sampai ESP32 kirim data
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

  // Sembunyikan export button untuk non-admin
  if (userRole !== 'admin') {
    const exportBtn = document.querySelector('.export-btn');
    if (exportBtn) exportBtn.style.display = 'none';
  }

  // Sembunyikan kartu kontrol mode untuk non-admin
  if (userRole !== 'admin') {
    const modeControlCard = document.getElementById('modeControlCard');
    if (modeControlCard) modeControlCard.style.display = 'none';
  }

  initializeChart();
  startRealtimeListeners();

  console.log('✅ Dashboard aktif | Role:', userRole);
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

    // Jika ESP32 offline, jangan update tampilan sensor dari data lama Firebase
    if (!isOnline) return;

    // Baca nilai masing-masing sensor dari ESP
    const sensor1  = parseFloat(data.sensor1 ?? 0);
    const sensor2  = parseFloat(data.sensor2 ?? 0);
    const moisture = parseFloat(data.average  ?? ((sensor1 + sensor2) / 2));

    const s1El = document.getElementById('sensor1Value');
    const s2El = document.getElementById('sensor2Value');
    const avgEl = document.getElementById('averageValue');

    if (s1El) s1El.textContent = sensor1 === 0 ? 'N/A' : sensor1.toFixed(2) + '%';
    if (s2El) s2El.textContent = sensor2 === 0 ? 'N/A' : sensor2.toFixed(2) + '%';
    if (avgEl) avgEl.textContent = moisture.toFixed(2) + '%';

    updateMoistureAlert(moisture);

    moistureData.push({
      timestamp:  new Date(),
      sensor1:    sensor1,
      sensor2:    sensor2,
      moisture:   moisture,
      pumpStatus: pumpStatus,
      mode:       currentMode || 'otomatis'
    });

    if (moistureData.length > 500) moistureData.shift();

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
  // FIX: ini adalah satu-satunya sumber kebenaran untuk currentMode
  // ------------------------------------------
  onValue(ref(rtdb, '/control/mode'), (snapshot) => {

    const val = snapshot.val() || 'auto';
    // ESP pakai 'auto', web tampilkan 'otomatis'
    currentMode = (val === 'auto') ? 'otomatis' : 'manual';
    console.log('🔄 Mode dari Firebase:', val, '→ currentMode:', currentMode);
    updateModeDisplay();

  }, (error) => {
    console.error('Mode listener error:', error);
  });

  // ------------------------------------------
  // 4. LISTENER TIMESTAMP (/soil/lastUpdate)
  // ------------------------------------------
  onValue(ref(rtdb, '/soil/lastUpdate'), (snapshot) => {
    const val = snapshot.val();
    if (val === null) {
      setSensorOffline();
      return;
    }
    // Terima update baru → catat waktu browser
    lastUpdateValue    = val;
    lastUpdateReceived = Date.now();

    // Reset timer offline
    if (offlineCheckTimer) clearTimeout(offlineCheckTimer);
    offlineCheckTimer = setTimeout(() => {
      setSensorOffline();
    }, OFFLINE_TIMEOUT_MS);

    // Tandai sensor online
    setSensorOnline();
  });
}

// ===============================
// SET SENSOR OFFLINE (tampilan)
// ===============================
function setSensorOffline() {
  isOnline = false;

  const s1El  = document.getElementById('sensor1Value');
  const s2El  = document.getElementById('sensor2Value');
  const avgEl = document.getElementById('averageValue');

  if (s1El)  s1El.textContent  = 'N/A';
  if (s2El)  s2El.textContent  = 'N/A';
  if (avgEl) avgEl.textContent = 'N/A';
}

// ===============================
// SET SENSOR ONLINE (tampilan)
// ===============================
function setSensorOnline() {
  isOnline = true;
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
      modeDesc.innerHTML = '<span>⚠️</span><span><strong>Mode Manual:</strong> Sensor diabaikan — kontrol pompa dari tombol di bawah</span>';
    } else {
      modeDesc.className = 'alert success';
      modeDesc.innerHTML = '<span>⚡</span><span><strong>Mode Otomatis:</strong> Relay ON jika kelembaban &lt; 40%, OFF jika ≥ 40%</span>';
    }
  }

  // FIX: Panel manual muncul/hilang sesuai mode dari Firebase
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
    alertDiv.innerHTML = '<span>🔴</span><span><strong>KERING! (&lt; 40%)</strong> — Relay aktif otomatis (Mode Auto)</span>';
  } else if (moisture > 70) {
    alertDiv.className = 'alert warning';
    alertDiv.innerHTML = '<span>💧</span><span><strong>Terlalu Basah! (&gt; 70%)</strong> — Relay mati otomatis</span>';
  } else {
    alertDiv.className = 'alert success';
    alertDiv.innerHTML = '<span>🟢</span><span><strong>Lembab Normal (40–70%)</strong> — Kelembaban optimal</span>';
  }
}

// ===============================
// SET DEFAULT VALUES
// ===============================
function setDefaultValues() {
  const el1 = document.getElementById('sensor1Value');
  const el2 = document.getElementById('sensor2Value');
  const elA = document.getElementById('averageValue');
  if (el1) el1.textContent = 'N/A';
  if (el2) el2.textContent = 'N/A';
  if (elA) elA.textContent = '0%';
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
    // Web kirim 'otomatis' → Firebase simpan 'auto' (agar ESP32 baca)
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

    // CATATAN: currentMode akan diupdate otomatis oleh listener /control/mode
    // Tidak perlu set manual di sini — listener yang jadi sumber kebenaran

  } catch (error) {
    console.error('setMode error:', error);
    alert('Gagal mengubah mode: ' + error.message);
  }
}

// ===============================
// CONTROL PUMP (dipanggil dari tombol HTML)
// FIX: baca mode terbaru langsung dari Firebase sebelum eksekusi
// ===============================
window.controlPump = async function(status) {

  if (getUserRole() !== 'admin') {
    alert('⚠️ Hanya Admin yang dapat mengontrol pompa!');
    return;
  }

  try {
    // Baca mode TERKINI dari Firebase secara langsung (bukan dari variabel lokal)
    const modeSnapshot = await get(ref(rtdb, '/control/mode'));
    const modeVal = modeSnapshot.val();
    const isManualNow = (modeVal === 'manual');

    if (!isManualNow) {
      alert('⚠️ Ubah ke Mode Manual dulu sebelum kontrol pompa!');
      return;
    }

    const pumpValue = (status === 'ON') ? 1 : 0;

    // Kirim perintah ke /control/pump (dibaca ESP32)
    await set(ref(rtdb, '/control/pump'), pumpValue);

    // FIX: Tulis juga ke /pump/status dan /pump/statusStr agar display web
    // langsung update tanpa harus menunggu ESP32 aktif mengirim data
    await set(ref(rtdb, '/pump/status'), pumpValue);
    await set(ref(rtdb, '/pump/statusStr'), status);

    // FIX: Update display pompa langsung (optimistic update)
    pumpStatus = status;
    updatePumpDisplay();

    console.log(`✅ Perintah pompa dikirim ke Firebase: ${status} (${pumpValue})`);

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
          label: 'Sensor 1',
          data: [],
          borderColor: '#007bff',
          backgroundColor: 'rgba(0,123,255,0.05)',
          tension: 0.4,
          pointRadius: 3,
          borderWidth: 2
        },
        {
          label: 'Sensor 2',
          data: [],
          borderColor: '#28a745',
          backgroundColor: 'rgba(40,167,69,0.05)',
          tension: 0.4,
          pointRadius: 3,
          borderWidth: 2
        },
        {
          label: 'Rata-rata',
          data: [],
          borderColor: '#6f42c1',
          backgroundColor: 'rgba(111,66,193,0.05)',
          tension: 0.4,
          pointRadius: 3,
          borderWidth: 2,
          borderDash: [4, 2]
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
  chart.data.datasets[0].data  = displayData.map(d => d.sensor1);
  chart.data.datasets[1].data  = displayData.map(d => d.sensor2);
  chart.data.datasets[2].data  = displayData.map(d => d.moisture);

  // Garis putus-putus threshold 40% sepanjang chart
  chart.data.datasets[3].data  = displayData.map(() => THRESHOLD_KERING);

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
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:#6c757d;">Belum ada data</td></tr>';
    return;
  }

  const recentData = [...moistureData].reverse().slice(0, 30);

  recentData.forEach(data => {
    const row = tbody.insertRow();

    row.insertCell(0).textContent = formatDateTime(data.timestamp);

    const s1Cell = row.insertCell(1);
    s1Cell.textContent  = data.sensor1 === 0 ? 'N/A' : data.sensor1.toFixed(2) + '%';
    s1Cell.style.fontWeight = 'bold';
    s1Cell.style.color  = data.sensor1 === 0 ? '#adb5bd' : '';

    const s2Cell = row.insertCell(2);
    s2Cell.textContent  = data.sensor2 === 0 ? 'N/A' : data.sensor2.toFixed(2) + '%';
    s2Cell.style.fontWeight = 'bold';
    s2Cell.style.color  = data.sensor2 === 0 ? '#adb5bd' : '';

    row.insertCell(3).textContent = data.moisture.toFixed(2) + '%';

    const pumpCell = row.insertCell(4);
    pumpCell.textContent      = data.pumpStatus;
    pumpCell.style.fontWeight = 'bold';
    pumpCell.style.color      = data.pumpStatus === 'ON' ? '#28a745' : '#dc3545';

    row.insertCell(5).textContent = data.mode === 'otomatis' ? 'Otomatis' : 'Manual';
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

  const ws_data = [['Waktu', 'Sensor 1 (%)', 'Sensor 2 (%)', 'Rata-rata (%)', 'Status Pompa', 'Mode']];

  [...moistureData].reverse().slice(0, 100).forEach(d => {
    ws_data.push([
      formatDateTime(d.timestamp),
      d.sensor1 === 0 ? 'N/A' : d.sensor1,
      d.sensor2 === 0 ? 'N/A' : d.sensor2,
      d.moisture,
      d.pumpStatus,
      d.mode === 'otomatis' ? 'Otomatis' : 'Manual'
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(ws_data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Data Kelembaban');
  XLSX.writeFile(wb, 'kelembaban_' + new Date().toISOString().split('T')[0] + '.xlsx');
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