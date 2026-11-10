// ============================================================================
// ENDOMONDO NEO — MOTOR INTERACTIVO WEB & PWA (GPS + AUDIO COACH + LOCAL-FIRST)
// ============================================================================

const SPORTS_CONFIG = {
  running: { name: 'Correr', icon: '🏃', met: 9.8, autoPauseMs: 0.65, defaults: ['duration', 'distance', 'pace_current', 'heart_rate'] },
  trail_running: { name: 'Trail Running', icon: '⛰️', met: 11.2, autoPauseMs: 0.45, defaults: ['duration', 'distance', 'elevation_gain', 'heart_rate'] },
  cycling_road: { name: 'Ciclismo en Ruta', icon: '🚴', met: 8.5, autoPauseMs: 1.4, defaults: ['duration', 'distance', 'speed_kmh', 'heart_rate'] },
  cycling_mtb: { name: 'Ciclismo MTB', icon: '🚵', met: 9.5, autoPauseMs: 1.1, defaults: ['duration', 'distance', 'speed_kmh', 'elevation_gain'] },
  walking: { name: 'Caminar', icon: '🚶', met: 3.8, autoPauseMs: 0.35, defaults: ['duration', 'distance', 'pace_avg', 'calories'] },
  hiking: { name: 'Senderismo', icon: '🥾', met: 6.0, autoPauseMs: 0.3, defaults: ['duration', 'distance', 'elevation_gain', 'calories'] },
  kayaking: { name: 'Kayak', icon: '🛶', met: 5.5, autoPauseMs: 0.4, defaults: ['duration', 'distance', 'speed_kmh', 'heart_rate'] },
  roller_skating: { name: 'Patinaje en Línea', icon: '🛼', met: 7.5, autoPauseMs: 0.9, defaults: ['duration', 'distance', 'speed_kmh', 'calories'] },
  xc_skiing: { name: 'Esquí de Fondo', icon: '⛷️', met: 9.0, autoPauseMs: 0.6, defaults: ['duration', 'distance', 'pace_current', 'elevation_gain'] },
};

const METRIC_CATALOG = [
  { key: 'duration', label: 'DURACIÓN ACTIVA', unit: 'min:seg · pulsa para cambiar' },
  { key: 'distance', label: 'DISTANCIA', unit: 'km · pulsa para cambiar' },
  { key: 'pace_current', label: 'RITMO ACTUAL', unit: 'min/km · pulsa para cambiar' },
  { key: 'pace_avg', label: 'RITMO MEDIO', unit: 'min/km · pulsa para cambiar' },
  { key: 'pace_lap', label: 'RITMO VUELTA ACTUAL', unit: 'min/km · pulsa para cambiar' },
  { key: 'speed_kmh', label: 'VELOCIDAD', unit: 'km/h · pulsa para cambiar' },
  { key: 'heart_rate', label: 'FREC. CARDÍACA', unit: 'ppm · pulsa para cambiar' },
  { key: 'calories', label: 'CALORÍAS', unit: 'kcal · pulsa para cambiar' },
  { key: 'elevation_gain', label: 'ASCENSO (+)', unit: 'metros · pulsa para cambiar' },
  { key: 'hydration_ml', label: 'HIDRATACIÓN', unit: 'ml · pulsa para cambiar' },
];

// Estado global de la sesión
const state = {
  sportId: 'running',
  status: 'idle', // 'idle' | 'active' | 'auto_paused' | 'manual_paused' | 'completed'
  audioCoachEnabled: true,
  autoPauseEnabled: true,
  targetPaceSecPerKm: 300,
  tileMetrics: ['duration', 'distance', 'pace_current', 'heart_rate'],
  activeDurationSec: 0,
  distanceMeters: 0,
  currentSpeedMs: 0,
  currentPaceSecPerKm: 0,
  avgPaceSecPerKm: 0,
  currentLapPaceSecPerKm: 0,
  elevationGainMeters: 0,
  currentAltitude: 655,
  caloriesKcal: 0,
  hydrationMl: 0,
  heartRateBpm: 138,
  bleConnected: false,
  lastLapDistanceMeters: 0,
  lastLapDurationSec: 0,
  lastLapStartAltitude: 655,
  lowSpeedStreak: 0,
  resumeSpeedStreak: 0,
  points: [],
  laps: [],
};

// Inicialización del Mapa Vectorial Leaflet (CartoDB Dark Matter)
const map = L.map('liveMap', { zoomControl: true }).setView([40.4153, -3.6845], 15);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; OpenStreetMap & CartoDB',
  maxZoom: 19,
}).addTo(map);

const routePolyline = L.polyline([], { color: '#87c80a', weight: 5 }).addTo(map);
let currentMarker = null;
const lapMarkers = [];

// Utilidades de formato
function formatDuration(sec) {
  const s = Math.max(0, Math.floor(sec));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

function formatPace(secPerKm) {
  if (!Number.isFinite(secPerKm) || secPerKm <= 0 || secPerKm > 3600) return '--:--';
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ============================================================================
// AUDIO COACH CON SÍNTESIS DE VOZ (Web Speech API)
// ============================================================================
function logAndSpeakCoach(text, type = 'coach') {
  const feed = document.getElementById('audioCoachFeed');
  const item = document.createElement('div');
  item.className = `coach-msg ${type === 'peptalk' ? 'peptalk' : ''}`;
  const timeStr = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  item.innerHTML = `<span>[${timeStr}]</span> ${text}`;
  feed.prepend(item);

  if (!state.audioCoachEnabled || !('speechSynthesis' in window)) return;
  try {
    const utter = new SpeechSynthesisUtterance(text.replace(/<[^>]*>/g, ''));
    utter.lang = 'es-ES';
    utter.rate = 1.04;
    window.speechSynthesis.speak(utter);
  } catch (e) {
    console.warn('TTS no disponible:', e);
  }
}

// ============================================================================
// PROCESADOR DE MUESTRAS GPS + DETECTOR DE VUELTAS Y AUTO-PAUSA
// ============================================================================
function ingestGpsSample(lat, lon, alt, dtSec, forcedSpeedMs = null) {
  if (state.status !== 'active' && state.status !== 'auto_paused') return;

  const sport = SPORTS_CONFIG[state.sportId];
  const prevPt = state.points[state.points.length - 1] || null;

  let stepMeters = 0;
  if (prevPt) {
    stepMeters = haversineMeters(prevPt.lat, prevPt.lon, lat, lon);
  }

  const speedMs = forcedSpeedMs !== null ? forcedSpeedMs : (dtSec > 0 ? stepMeters / dtSec : 0);

  // Detección de Auto-Pausa con histéresis
  if (state.autoPauseEnabled) {
    if (speedMs < sport.autoPauseMs) {
      state.lowSpeedStreak += 1;
      state.resumeSpeedStreak = 0;
      if (state.lowSpeedStreak >= 2 && state.status === 'active') {
        state.status = 'auto_paused';
        document.getElementById('autoPauseBanner').classList.remove('hidden');
        logAndSpeakCoach('⏸️ Entrenamiento en auto-pausa.');
      }
    } else {
      state.resumeSpeedStreak += 1;
      state.lowSpeedStreak = 0;
      if (state.resumeSpeedStreak >= 1 && state.status === 'auto_paused') {
        state.status = 'active';
        document.getElementById('autoPauseBanner').classList.add('hidden');
        logAndSpeakCoach('▶️ En movimiento. Entrenamiento reanudado.');
      }
    }
  }

  if (state.status === 'auto_paused') {
    state.currentSpeedMs = 0;
    state.currentPaceSecPerKm = 0;
    renderAllMetrics();
    return;
  }

  state.activeDurationSec += dtSec;
  state.distanceMeters += stepMeters;
  state.currentSpeedMs = speedMs;
  state.currentPaceSecPerKm = speedMs > 0.3 ? 1000 / speedMs : 0;
  state.avgPaceSecPerKm =
    state.distanceMeters > 15 ? (state.activeDurationSec / state.distanceMeters) * 1000 : state.currentPaceSecPerKm;

  const lapDist = state.distanceMeters - state.lastLapDistanceMeters;
  const lapTime = state.activeDurationSec - state.lastLapDurationSec;
  state.currentLapPaceSecPerKm = lapDist > 10 ? (lapTime / lapDist) * 1000 : state.currentPaceSecPerKm;

  const altDelta = prevPt ? alt - prevPt.alt : 0;
  if (altDelta > 0.2) state.elevationGainMeters += altDelta;
  state.currentAltitude = alt;

  // Simular variación fisiológica de FC si no hay banda BLE conectada
  if (!state.bleConnected) {
    const targetHr = Math.min(186, Math.round(115 + speedMs * 11 + (altDelta > 0 ? 6 : 0)));
    state.heartRateBpm = Math.round(state.heartRateBpm * 0.8 + targetHr * 0.2);
  }

  const hours = state.activeDurationSec / 3600;
  state.caloriesKcal = Math.round(sport.met * 72 * hours);
  state.hydrationMl = Math.round(state.caloriesKcal * 1.15);

  const pt = {
    ts: Date.now(),
    lat,
    lon,
    alt,
    dist: state.distanceMeters,
    hr: state.heartRateBpm,
    pace: state.currentPaceSecPerKm,
  };
  state.points.push(pt);

  // Actualizar Mapa en vivo
  routePolyline.addLatLng([lat, lon]);
  if (!currentMarker) {
    currentMarker = L.circleMarker([lat, lon], {
      radius: 8,
      fillColor: '#87c80a',
      color: '#ffffff',
      weight: 2,
      fillOpacity: 1,
    }).addTo(map);
  } else {
    currentMarker.setLatLng([lat, lon]);
  }
  map.panTo([lat, lon], { animate: true });

  // Comprobar si se completó un nuevo kilómetro (Lap Split de 1,000 m)
  if (state.distanceMeters - state.lastLapDistanceMeters >= 1000) {
    const lapNumber = state.laps.length + 1;
    const lapDurationSec = Math.max(1, Math.round(state.activeDurationSec - state.lastLapDurationSec));
    const lapPaceSec = lapDurationSec;
    const elevDelta = Math.round(alt - state.lastLapStartAltitude);

    const lapObj = {
      lapNumber,
      durationSec: lapDurationSec,
      paceSecPerKm: lapPaceSec,
      elevDelta,
      avgHr: state.heartRateBpm,
    };
    state.laps.push(lapObj);

    state.lastLapDistanceMeters += 1000;
    state.lastLapDurationSec = state.activeDurationSec;
    state.lastLapStartAltitude = alt;

    // Pin de Kilómetro en el mapa
    const kmPin = L.marker([lat, lon], {
      title: `KM ${lapNumber} (${formatPace(lapPaceSec)}/km)`,
    })
      .addTo(map)
      .bindPopup(`<strong>KM ${lapNumber}</strong><br/>Ritmo: ${formatPace(lapPaceSec)} /km<br/>FC: ${state.heartRateBpm} ppm`);
    lapMarkers.push(kmPin);

    renderLapsTable();

    // Anuncio de Audio Coach del Kilómetro
    const mins = Math.floor(lapPaceSec / 60);
    const secs = Math.round(lapPaceSec % 60);
    const targetTotal = lapNumber * state.targetPaceSecPerKm;
    const ghostDelta = Math.round(targetTotal - state.activeDurationSec);
    const ghostPhrase =
      ghostDelta >= 0
        ? `Vas ${ghostDelta} segundos por delante de tu objetivo.`
        : `Vas ${Math.abs(ghostDelta)} segundos por detrás de tu objetivo.`;

    logAndSpeakCoach(
      `🔊 <strong>Kilómetro ${lapNumber} completado:</strong> Último km en ${mins} minutos y ${secs} segundos. Frecuencia cardíaca ${state.heartRateBpm} pulsaciones. ${ghostPhrase}`
    );
  }

  renderAllMetrics();
}

// ============================================================================
// RENDERIZADO DE LA CUADRÍCULA DE 4 MÉTRICAS Y TABLA DE PARCIALES
// ============================================================================
function getMetricFormattedValue(key) {
  switch (key) {
    case 'duration':
      return formatDuration(state.activeDurationSec);
    case 'distance':
      return (state.distanceMeters / 1000).toFixed(2);
    case 'pace_current':
      return formatPace(state.currentPaceSecPerKm);
    case 'pace_avg':
      return formatPace(state.avgPaceSecPerKm);
    case 'pace_lap':
      return formatPace(state.currentLapPaceSecPerKm);
    case 'speed_kmh':
      return (state.currentSpeedMs * 3.6).toFixed(1);
    case 'heart_rate':
      return `${state.heartRateBpm}`;
    case 'calories':
      return `${state.caloriesKcal}`;
    case 'elevation_gain':
      return `+${Math.round(state.elevationGainMeters)}`;
    case 'hydration_ml':
      return `${state.hydrationMl}`;
    default:
      return '--';
  }
}

function renderAllMetrics() {
  state.tileMetrics.forEach((key, idx) => {
    const meta = METRIC_CATALOG.find((m) => m.key === key);
    document.getElementById(`tileLabel${idx}`).textContent = meta.label;
    const valEl = document.getElementById(`tileValue${idx}`);
    valEl.textContent = getMetricFormattedValue(key);
    valEl.classList.toggle('heart', key === 'heart_rate');
    document.getElementById(`tileUnit${idx}`).textContent = meta.unit;
  });

  // Ghost Pacer Bar
  const expectedTimeAtDist = (state.distanceMeters / 1000) * state.targetPaceSecPerKm;
  const deltaSec = Math.round(expectedTimeAtDist - state.activeDurationSec);
  const ghostEl = document.getElementById('ghostDeltaText');
  if (state.distanceMeters < 20) {
    ghostEl.textContent = `👻 Ghost Pacer: Objetivo ${formatPace(state.targetPaceSecPerKm)} /km`;
  } else if (deltaSec >= 0) {
    ghostEl.innerHTML = `👻 Ghost Pacer: <strong style="color:#87c80a">+${deltaSec}s de ventaja</strong> sobre objetivo (${formatPace(state.targetPaceSecPerKm)}/km)`;
  } else {
    ghostEl.innerHTML = `👻 Ghost Pacer: <strong style="color:#fb7185">${deltaSec}s detrás</strong> del objetivo (${formatPace(state.targetPaceSecPerKm)}/km)`;
  }

  document.getElementById('hydrationBadge').textContent = `💧 Hidratación: ${state.hydrationMl} ml`;
}

function renderLapsTable() {
  const tbody = document.getElementById('lapsTableBody');
  document.getElementById('lapCountBadge').textContent = `${state.laps.length} vueltas`;
  if (state.laps.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-row">Inicia el entrenamiento para registrar parciales cada 1,000 m.</td></tr>`;
    return;
  }

  tbody.innerHTML = state.laps
    .slice()
    .reverse()
    .map((lap) => {
      const diff = lap.paceSecPerKm - state.targetPaceSecPerKm;
      const diffStr = diff <= 0 ? `<span style="color:#87c80a">${diff}s</span>` : `<span style="color:#fb7185">+${diff}s</span>`;
      const elevStr = lap.elevDelta >= 0 ? `+${lap.elevDelta}m` : `${lap.elevDelta}m`;
      return `
        <tr>
          <td><strong>KM ${lap.lapNumber}</strong></td>
          <td>${formatPace(lap.paceSecPerKm)} /km</td>
          <td>${diffStr}</td>
          <td>${elevStr}</td>
          <td>❤️ ${lap.avgHr} ppm</td>
        </tr>
      `;
    })
    .join('');
}

// ============================================================================
// SIMULADOR CINEMÁTICO + GPS REAL DEL NAVEGADOR
// ============================================================================
let simTimer = null;
let geoWatchId = null;
let simAngleRad = 0;
let simLat = 40.4153;
let simLon = -3.6845;
let simAlt = 655;

function startTrackingLoop() {
  const source = document.getElementById('gpsSourceSelect').value;
  if (source === 'real' && 'geolocation' in navigator) {
    geoWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        ingestGpsSample(
          pos.coords.latitude,
          pos.coords.longitude,
          pos.coords.altitude || 650,
          1,
          pos.coords.speed
        );
      },
      (err) => {
        logAndSpeakCoach(`⚠️ Error GPS real (${err.message}). Cambiando a Simulador.`);
      },
      { enableHighAccuracy: true, maximumAge: 0 }
    );
  } else {
    simTimer = setInterval(() => {
      if (state.status !== 'active' && state.status !== 'auto_paused') return;
      const mult = Number(document.getElementById('simSpeedSelect').value);
      if (mult === 0) {
        // Simula parada en semáforo para probar Auto-Pausa
        ingestGpsSample(simLat, simLon, simAlt, 1, 0.1);
        return;
      }

      // Velocidad base ~3.45 m/s (~4:50 min/km en running)
      const baseSpeedMs = state.sportId.startsWith('cycling') ? 7.8 : 3.45;
      const dtSec = mult;
      const stepDist = baseSpeedMs * dtSec;

      // Circuito perimetral por el Parque del Retiro
      simAngleRad += 0.018 * mult;
      const dLat = (Math.cos(simAngleRad) * stepDist) / 111320;
      const dLon = (Math.sin(simAngleRad) * stepDist) / (111320 * Math.cos((simLat * Math.PI) / 180));
      simLat += dLat;
      simLon += dLon;
      simAlt += Math.sin(simAngleRad * 2) * 0.45;

      ingestGpsSample(simLat, simLon, simAlt, dtSec, baseSpeedMs);
    }, 1000);
  }
}

function stopTrackingLoop() {
  if (simTimer) {
    clearInterval(simTimer);
    simTimer = null;
  }
  if (geoWatchId !== null && 'geolocation' in navigator) {
    navigator.geolocation.clearWatch(geoWatchId);
    geoWatchId = null;
  }
}

// ============================================================================
// PERSISTENCIA LOCAL-FIRST Y EXPORTACIÓN GPX
// ============================================================================
function saveWorkoutLocalFirst() {
  const saved = JSON.parse(localStorage.getItem('endomondo_neo_workouts') || '[]');
  const sport = SPORTS_CONFIG[state.sportId];
  const record = {
    id: `endo-${Date.now()}`,
    date: new Date().toLocaleString('es-ES'),
    sportName: `${sport.icon} ${sport.name}`,
    distanceKm: (state.distanceMeters / 1000).toFixed(2),
    duration: formatDuration(state.activeDurationSec),
    avgPace: formatPace(state.avgPaceSecPerKm),
    calories: state.caloriesKcal,
    lapsCount: state.laps.length,
  };
  saved.unshift(record);
  localStorage.setItem('endomondo_neo_workouts', JSON.stringify(saved.slice(0, 15)));
  renderSavedWorkouts();
}

function renderSavedWorkouts() {
  const listEl = document.getElementById('savedWorkoutsList');
  const saved = JSON.parse(localStorage.getItem('endomondo_neo_workouts') || '[]');
  if (saved.length === 0) {
    listEl.innerHTML = `<div class="saved-item"><span>Sin entrenamientos guardados aún en SQLite/Local.</span></div>`;
    return;
  }
  listEl.innerHTML = saved
    .map(
      (w) => `
      <div class="saved-item">
        <div>
          <strong>${w.sportName} · ${w.distanceKm} km</strong>
          <div style="color:#9ca3af;font-size:11px">${w.date} · ${w.lapsCount} vueltas</div>
        </div>
        <div style="text-align:right">
          <strong style="color:#87c80a">${w.duration}</strong>
          <div style="color:#9ca3af;font-size:11px">${w.avgPace}/km · ${w.calories} kcal</div>
        </div>
      </div>
    `
    )
    .join('');
}

function exportCurrentRouteToGpx() {
  if (state.points.length === 0) return;
  const trkpts = state.points
    .map(
      (p) => `
      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}">
        <ele>${p.alt.toFixed(1)}</ele>
        <time>${new Date(p.ts).toISOString()}</time>
      </trkpt>`
    )
    .join('');

  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Endomondo Neo">
  <trk>
    <name>Endomondo Neo - ${SPORTS_CONFIG[state.sportId].name}</name>
    <trkseg>${trkpts}
    </trkseg>
  </trk>
</gpx>`;

  const blob = new Blob([gpx], { type: 'application/gpx+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `endomondo-neo-${state.sportId}-${Date.now()}.gpx`;
  a.click();
  URL.revokeObjectURL(url);
}

// ============================================================================
// EVENT LISTENERS DE LA INTERFAZ
// ============================================================================
document.querySelectorAll('.metric-tile').forEach((tile) => {
  tile.addEventListener('click', () => {
    const idx = Number(tile.dataset.tileIndex);
    const currentKey = state.tileMetrics[idx];
    const currentCatalogIdx = METRIC_CATALOG.findIndex((m) => m.key === currentKey);
    const nextCatalogIdx = (currentCatalogIdx + 1) % METRIC_CATALOG.length;
    state.tileMetrics[idx] = METRIC_CATALOG[nextCatalogIdx].key;
    renderAllMetrics();
  });
});

document.getElementById('sportSelect').addEventListener('change', (e) => {
  state.sportId = e.target.value;
  state.tileMetrics = [...SPORTS_CONFIG[state.sportId].defaults];
  renderAllMetrics();
});

document.getElementById('targetPaceSelect').addEventListener('change', (e) => {
  state.targetPaceSecPerKm = Number(e.target.value);
  renderAllMetrics();
});

document.getElementById('btnAudioCoach').addEventListener('click', (e) => {
  state.audioCoachEnabled = !state.audioCoachEnabled;
  e.currentTarget.classList.toggle('active', state.audioCoachEnabled);
  e.currentTarget.textContent = `🔊 Audio Coach: ${state.audioCoachEnabled ? 'ON' : 'OFF'}`;
});

document.getElementById('btnAutoPause').addEventListener('click', (e) => {
  state.autoPauseEnabled = !state.autoPauseEnabled;
  e.currentTarget.classList.toggle('active', state.autoPauseEnabled);
  e.currentTarget.textContent = `⏸️ Auto-Pausa: ${state.autoPauseEnabled ? 'ON' : 'OFF'}`;
});

document.getElementById('btnConnectBle').addEventListener('click', async () => {
  if (!navigator.bluetooth) {
    logAndSpeakCoach('ℹ️ Web Bluetooth requiere Chrome/Edge o la App Nativa Expo. Usando sensor FC virtual.');
    return;
  }
  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: ['heart_rate'] }],
    });
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService('heart_rate');
    const char = await service.getCharacteristic('heart_rate_measurement');
    await char.startNotifications();
    state.bleConnected = true;
    char.addEventListener('characteristicvaluechanged', (event) => {
      const value = event.target.value;
      const flags = value.getUint8(0);
      const hr = (flags & 0x01) === 0 ? value.getUint8(1) : value.getUint16(1, true);
      state.heartRateBpm = hr;
      renderAllMetrics();
    });
    logAndSpeakCoach(`💙 Banda Bluetooth ${device.name || 'FC'} conectada en tiempo real.`);
  } catch (err) {
    logAndSpeakCoach(`ℹ️ Conexión BLE cancelada (${err.message}).`);
  }
});

document.getElementById('btnStart').addEventListener('click', () => {
  state.status = 'active';
  state.activeDurationSec = 0;
  state.distanceMeters = 0;
  state.elevationGainMeters = 0;
  state.lastLapDistanceMeters = 0;
  state.lastLapDurationSec = 0;
  state.points = [];
  state.laps = [];
  routePolyline.setLatLngs([]);
  lapMarkers.forEach((m) => map.removeLayer(m));
  lapMarkers.length = 0;

  document.getElementById('btnStart').classList.add('hidden');
  document.getElementById('btnPause').classList.remove('hidden');
  document.getElementById('btnStop').classList.remove('hidden');
  document.getElementById('btnExportGpx').disabled = false;

  renderLapsTable();
  renderAllMetrics();
  const sport = SPORTS_CONFIG[state.sportId];
  logAndSpeakCoach(`🚀 Entrenamiento de ${sport.name} iniciado. ¡A por todas!`);
  startTrackingLoop();
});

document.getElementById('btnPause').addEventListener('click', (e) => {
  if (state.status === 'manual_paused') {
    state.status = 'active';
    e.currentTarget.textContent = '⏸ PAUSAR';
    logAndSpeakCoach('▶️ Entrenamiento reanudado.');
  } else {
    state.status = 'manual_paused';
    e.currentTarget.textContent = '▶ REANUDAR';
    logAndSpeakCoach('⏸️ Entrenamiento en pausa manual.');
  }
});

document.getElementById('btnStop').addEventListener('click', () => {
  stopTrackingLoop();
  state.status = 'completed';
  document.getElementById('autoPauseBanner').classList.add('hidden');
  document.getElementById('btnStart').classList.remove('hidden');
  document.getElementById('btnPause').classList.add('hidden');
  document.getElementById('btnStop').classList.add('hidden');

  saveWorkoutLocalFirst();
  logAndSpeakCoach(
    `🏁 Entrenamiento finalizado. Distancia total: ${(state.distanceMeters / 1000).toFixed(2)} kilómetros en ${formatDuration(state.activeDurationSec)}. Guardado en base de datos local.`
  );
});

document.getElementById('btnExportGpx').addEventListener('click', exportCurrentRouteToGpx);

document.getElementById('peptalkForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const author = document.getElementById('peptalkAuthor').value.trim() || 'Amigo';
  const msg = document.getElementById('peptalkText').value.trim();
  if (!msg) return;
  logAndSpeakCoach(`💬 <strong>Peptalk en vivo de ${author}:</strong> "¡${msg}!"`, 'peptalk');
  document.getElementById('peptalkText').value = '';
});

// Inicializar vista al cargar
renderAllMetrics();
renderSavedWorkouts();
