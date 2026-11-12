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
  { key: 'cadence', label: 'CADENCIA', unit: 'spm (pasos/min) · pulsa para cambiar' },
  { key: 'power_watts', label: 'POTENCIA', unit: 'vatios (W) · pulsa para cambiar' },
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
  maxHeartRateBpm: 190,
  cadenceSpm: 166,
  powerWatts: 0,
  stepsCount: 0,
  bleConnected: false,
  bleDeviceName: '',
  lastLapDistanceMeters: 0,
  lastLapDurationSec: 0,
  lastLapStartAltitude: 655,
  lowSpeedStreak: 0,
  resumeSpeedStreak: 0,
  points: [],
  laps: [],
};

// Inicialización del Mapa Vectorial Leaflet (100% Libre de API Key: OpenStreetMap + Esri Topo/Satélite)
const map = L.map('liveMap', { zoomControl: true }).setView([40.4153, -3.6845], 15);

const osmStreetLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap',
  maxZoom: 19,
  className: 'endo-dark-map-tiles',
});

const esriStreetLayer = L.tileLayer(
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
  {
    attribution: '&copy; Esri',
    maxZoom: 19,
  }
);

const esriSatelliteLayer = L.tileLayer(
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  {
    attribution: '&copy; Esri Satellite',
    maxZoom: 19,
  }
);

osmStreetLayer.addTo(map);
L.control
  .layers(
    {
      '🌙 Deportivo Oscuro (OSM)': osmStreetLayer,
      '🗺️ Callejero Claro': esriStreetLayer,
      '🛰️ Satélite Trail': esriSatelliteLayer,
    },
    null,
    { position: 'topright' }
  )
  .addTo(map);

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

  if (!state.audioCoachEnabled) return;
  const cleanSpeechText = text.replace(/<[^>]*>/g, '').replace(/[🔊⏸️▶️🚀🏁💬⚠️ℹ️💙]/g, '').trim();

  // Puente nativo Android APK (TextToSpeech + Audio Ducking + Vibración)
  if (window.AndroidBridge && typeof window.AndroidBridge.speak === 'function') {
    window.AndroidBridge.speak(cleanSpeechText);
    if (typeof window.AndroidBridge.vibrate === 'function') {
      window.AndroidBridge.vibrate(180);
    }
    return;
  }

  if (!('speechSynthesis' in window)) return;
  try {
    const utter = new SpeechSynthesisUtterance(cleanSpeechText);
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
    if (typeof trackAnalyticsEvent === 'function') {
      trackAnalyticsEvent('lap_completed', {
        lap_number: lapNumber,
        pace_sec_per_km: lapPaceSec,
        heart_rate_bpm: state.heartRateBpm,
        elev_delta_m: elevDelta,
      });
    }
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
    case 'cadence':
      return `${state.cadenceSpm}`;
    case 'power_watts':
      return state.powerWatts > 0 ? `${state.powerWatts}` : '--';
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
  renderHeartRateZoneStrip();
}

function getHeartRateZoneInfo(bpm, maxHr = state.maxHeartRateBpm) {
  const pct = (bpm / Math.max(120, maxHr)) * 100;
  if (pct < 60) return { zone: 1, name: 'Recuperación', color: '#38bdf8', bg: 'rgba(56,189,248,0.18)' };
  if (pct < 70) return { zone: 2, name: 'Quema de Grasa', color: '#87c80a', bg: 'rgba(135,200,10,0.18)' };
  if (pct < 80) return { zone: 3, name: 'Aeróbica', color: '#facc15', bg: 'rgba(250,204,21,0.18)' };
  if (pct < 90) return { zone: 4, name: 'Umbral Anaeróbico', color: '#fb923c', bg: 'rgba(251,146,60,0.22)' };
  return { zone: 5, name: 'Esfuerzo Máximo', color: '#f87171', bg: 'rgba(248,113,113,0.25)' };
}

function renderHeartRateZoneStrip() {
  const badge = document.getElementById('hrZoneBadge');
  if (!badge) return;
  const z = getHeartRateZoneInfo(state.heartRateBpm, state.maxHeartRateBpm);
  const srcTag = state.bleConnected ? `💙 ${state.bleDeviceName || 'BLE'}` : '❤️ Pulso';
  badge.textContent = `${srcTag}: Zona ${z.zone} (${z.name} · ${state.heartRateBpm} ppm)`;
  badge.style.color = z.color;
  badge.style.background = z.bg;

  const cadEl = document.getElementById('liveCadenceBadge');
  if (cadEl) cadEl.textContent = `👟 Cadencia: ${state.cadenceSpm} spm`;
  const stepEl = document.getElementById('liveStepsBadge');
  if (stepEl) stepEl.textContent = `👣 Pasos: ${state.stepsCount}`;
  const pwrEl = document.getElementById('livePowerBadge');
  if (pwrEl) pwrEl.textContent = `⚡ Potencia: ${state.powerWatts > 0 ? state.powerWatts + ' W' : '-- W'}`;
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
  const workoutId = `endo-${Date.now()}`;
  const record = {
    id: workoutId,
    date: new Date().toLocaleString('es-ES'),
    sportId: state.sportId,
    sportName: `${sport.icon} ${sport.name}`,
    distanceKm: (state.distanceMeters / 1000).toFixed(2),
    distanceMeters: Math.round(state.distanceMeters),
    duration: formatDuration(state.activeDurationSec),
    activeDurationSec: Math.round(state.activeDurationSec),
    avgPace: formatPace(state.avgPaceSecPerKm),
    calories: state.caloriesKcal,
    elevationGainMeters: Math.round(state.elevationGainMeters),
    lapsCount: state.laps.length,
    userEmail: currentGoogleUser ? currentGoogleUser.email : 'Local',
    syncedToFirebase: false,
  };
  saved.unshift(record);
  localStorage.setItem('endomondo_neo_workouts', JSON.stringify(saved.slice(0, 25)));
  renderSavedWorkouts();
  if (typeof evaluateWorkoutAchievements === 'function') {
    evaluateWorkoutAchievements();
    renderSocialHub();
  }

  // Sincronizar automáticamente con Firebase Cloud Firestore si está configurado
  void syncWorkoutToFirebaseFirestore(record, state.points, state.laps);
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

document.getElementById('btnConnectBle').addEventListener('click', () => {
  document.getElementById('sensorsModal').classList.remove('hidden');
});

document.getElementById('btnCloseSensorsModal').addEventListener('click', () => {
  document.getElementById('sensorsModal').classList.add('hidden');
});

document.getElementById('maxHrInput').addEventListener('change', (e) => {
  const maxHr = Math.max(140, Math.min(220, Number(e.target.value) || 190));
  state.maxHeartRateBpm = maxHr;
  document.getElementById('z1Range').textContent = `${Math.round(maxHr * 0.5)}-${Math.round(maxHr * 0.6)} ppm`;
  document.getElementById('z2Range').textContent = `${Math.round(maxHr * 0.6)}-${Math.round(maxHr * 0.7)} ppm`;
  document.getElementById('z3Range').textContent = `${Math.round(maxHr * 0.7)}-${Math.round(maxHr * 0.8)} ppm`;
  document.getElementById('z4Range').textContent = `${Math.round(maxHr * 0.8)}-${Math.round(maxHr * 0.9)} ppm`;
  document.getElementById('z5Range').textContent = `${Math.round(maxHr * 0.9)}-${maxHr} ppm`;
  renderHeartRateZoneStrip();
});

// Callbacks desde el motor Bluetooth LE nativo de Android (MainActivity.java)
window.onAndroidBleDeviceFound = function (address, name, rssi) {
  const list = document.getElementById('discoveredBleList');
  if (!list) return;
  const existing = document.getElementById(`ble-dev-${address.replace(/:/g, '')}`);
  if (existing) return;

  const row = document.createElement('div');
  row.id = `ble-dev-${address.replace(/:/g, '')}`;
  row.className = 'saved-item';
  row.innerHTML = `
    <div>
      <strong>📡 ${name}</strong>
      <div style="font-size:10px;color:#9ca3af">${address} · Señal ${rssi} dBm</div>
    </div>
    <button type="button" class="btn-peptalk" onclick="window.connectAndroidBle('${address}', '${name}')">Conectar</button>
  `;
  list.prepend(row);
};

window.connectAndroidBle = function (address, name) {
  document.getElementById('bleModalStatusTitle').textContent = `Conectando a ${name}...`;
  if (window.AndroidBridge && typeof window.AndroidBridge.connectBleDeviceByAddress === 'function') {
    window.AndroidBridge.connectBleDeviceByAddress(address);
  }
};

window.onAndroidBleConnectionState = function (connected, devName, statusText) {
  state.bleConnected = Boolean(connected);
  state.bleDeviceName = devName || 'Sensor BLE';
  document.getElementById('bleModalStatusTitle').textContent = statusText;
  const btn = document.getElementById('btnConnectBle');
  if (btn) {
    btn.textContent = connected ? `💙 ${state.bleDeviceName}` : '💙 Sensores & Pulso';
  }
  if (connected) {
    unlockAchievement('ble_heart');
    logAndSpeakCoach(`💙 Sensor de pulso ${state.bleDeviceName} conectado en tiempo real.`);
    if (typeof trackAnalyticsEvent === 'function') {
      trackAnalyticsEvent('ble_sensor_connected', { device_name: state.bleDeviceName });
    }
  }
  renderHeartRateZoneStrip();
};

window.onAndroidBleHeartRate = function (bpm) {
  state.heartRateBpm = Number(bpm);
  state.bleConnected = true;
  renderAllMetrics();
};

window.onAndroidBleCadence = function (spm) {
  state.cadenceSpm = Number(spm);
  renderAllMetrics();
};

window.onAndroidBlePower = function (watts) {
  state.powerWatts = Number(watts);
  renderAllMetrics();
};

window.onAndroidStepCounter = function (steps) {
  state.stepsCount = Number(steps);
  renderHeartRateZoneStrip();
};

document.getElementById('btnStartBleScan').addEventListener('click', async () => {
  const list = document.getElementById('discoveredBleList');
  list.innerHTML = `<div class="coach-msg">🔍 Buscando dispositivos Bluetooth LE cercanos (Bandas FC, Relojes, Cadencia, Potencia)...</div>`;

  // 1. Si estamos en el APK Nativo de Android, usar BluetoothLeScanner nativo
  if (window.AndroidBridge && typeof window.AndroidBridge.startBleSensorScan === 'function') {
    document.getElementById('bleModalStatusTitle').textContent = 'Escaneando Bluetooth LE en Android...';
    window.AndroidBridge.startBleSensorScan();
    return;
  }

  // 2. Si estamos en navegador Chrome con Web Bluetooth API
  if (navigator.bluetooth) {
    try {
      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: false,
        filters: [
          { services: ['heart_rate'] },
          { services: ['running_speed_and_cadence'] },
          { services: ['cycling_power'] },
        ],
      });
      const server = await device.gatt.connect();
      const service = await server.getPrimaryService('heart_rate');
      const char = await service.getCharacteristic('heart_rate_measurement');
      await char.startNotifications();
      state.bleConnected = true;
      state.bleDeviceName = device.name || 'Banda BLE';
      char.addEventListener('characteristicvaluechanged', (event) => {
        const value = event.target.value;
        const flags = value.getUint8(0);
        const hr = (flags & 0x01) === 0 ? value.getUint8(1) : value.getUint16(1, true);
        state.heartRateBpm = hr;
        renderAllMetrics();
      });
      window.onAndroidBleConnectionState(true, state.bleDeviceName, `Conectado a ${state.bleDeviceName}`);
    } catch (err) {
      document.getElementById('bleModalStatusTitle').textContent = `Búsqueda cancelada (${err.message})`;
    }
  } else {
    list.innerHTML = `<div class="coach-msg">ℹ️ Pulsa <strong>"⚡ Simular Banda Polar H10 + Cadencia"</strong> abajo o usa la APK Android con Bluetooth activo.</div>`;
  }
});

let simPolarTimer = null;
document.getElementById('btnSimulatePolarStrap').addEventListener('click', () => {
  state.bleConnected = true;
  state.bleDeviceName = 'Polar H10 BLE';
  window.onAndroidBleConnectionState(true, 'Polar H10 BLE', '💙 Conectado a Polar H10 + Podómetro Stryd');
  if (simPolarTimer) clearInterval(simPolarTimer);
  simPolarTimer = setInterval(() => {
    const baseHr = state.status === 'active' ? 154 : 122;
    state.heartRateBpm = baseHr + Math.floor(Math.random() * 9) - 4;
    state.cadenceSpm = state.status === 'active' ? 172 + Math.floor(Math.random() * 6) : 0;
    state.powerWatts = state.status === 'active' ? 235 + Math.floor(Math.random() * 20) : 0;
    if (state.status === 'active') state.stepsCount += 3;
    renderAllMetrics();
  }, 1500);
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
  if (typeof trackAnalyticsEvent === 'function') {
    trackAnalyticsEvent('workout_start', {
      sport_id: state.sportId,
      target_pace_sec: state.targetPaceSecPerKm,
      audio_coach: state.audioCoachEnabled,
      auto_pause: state.autoPauseEnabled,
    });
  }
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
  if (typeof trackAnalyticsEvent === 'function') {
    trackAnalyticsEvent('workout_complete', {
      sport_id: state.sportId,
      distance_km: Number((state.distanceMeters / 1000).toFixed(2)),
      duration_sec: Math.round(state.activeDurationSec),
      calories_kcal: state.caloriesKcal,
      laps_count: state.laps.length,
    });
  }
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
  void sendPeptalkToFirebaseFirestore(author, msg);
  document.getElementById('peptalkText').value = '';
});

// ============================================================================
// BACKEND FIREBASE (CLOUD FIRESTORE + GOOGLE USER SYNC)
// ============================================================================
const DEFAULT_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBbLw9MwK6bF8l230jVCHZXsCDS84G8UwQ',
  authDomain: 'endomondo-neo.firebaseapp.com',
  projectId: 'endomondo-neo',
  storageBucket: 'endomondo-neo.firebasestorage.app',
  messagingSenderId: '177593536458',
  appId: '1:177593536458:web:4a739724fa93bee6128933',
  measurementId: 'G-3QDD46L6S4',
};

let firebaseConfig =
  JSON.parse(localStorage.getItem('endomondo_neo_firebase_config') || 'null') ||
  DEFAULT_FIREBASE_CONFIG;

function isFirebaseReady() {
  return Boolean(firebaseConfig && firebaseConfig.projectId && firebaseConfig.apiKey);
}

function getFirestoreBaseUrl() {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    firebaseConfig.projectId
  )}/databases/(default)/documents`;
}

function renderFirebaseStatusUI() {
  const btn = document.getElementById('btnFirebaseSetup');
  const syncBadge = document.getElementById('syncStatusBadge');
  if (!btn) return;
  if (isFirebaseReady()) {
    btn.classList.add('connected');
    btn.textContent = `🔥 Firebase: ${firebaseConfig.projectId}`;
    if (syncBadge) {
      syncBadge.textContent = `🔥 Firestore (${firebaseConfig.projectId})`;
    }
  } else {
    btn.classList.remove('connected');
    btn.textContent = '🔥 Firebase Backend';
  }
}

async function syncUserProfileToFirebaseFirestore(user) {
  if (!isFirebaseReady() || !user) return;
  try {
    const docId = encodeURIComponent(user.email);
    const url = `${getFirestoreBaseUrl()}/users/${docId}?key=${encodeURIComponent(
      firebaseConfig.apiKey
    )}`;
    await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          email: { stringValue: user.email },
          displayName: { stringValue: user.displayName },
          avatarUrl: { stringValue: user.avatarUrl || '' },
          updatedAt: { integerValue: `${Date.now()}` },
        },
      }),
    });
  } catch (err) {
    console.warn('Error sincronizando usuario en Firestore:', err);
  }
}

async function syncWorkoutToFirebaseFirestore(record, points = [], laps = []) {
  if (!isFirebaseReady()) return;
  try {
    const sampledPoints = points.slice(0, 200).map((p) => ({
      lat: Number(p.lat.toFixed(5)),
      lon: Number(p.lon.toFixed(5)),
      alt: Math.round(p.alt || 0),
    }));
    const url = `${getFirestoreBaseUrl()}/workouts/${encodeURIComponent(
      record.id
    )}?key=${encodeURIComponent(firebaseConfig.apiKey)}`;

    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          id: { stringValue: record.id },
          date: { stringValue: record.date },
          sportName: { stringValue: record.sportName },
          distanceKm: { stringValue: `${record.distanceKm}` },
          duration: { stringValue: record.duration },
          avgPace: { stringValue: record.avgPace },
          calories: { integerValue: `${record.calories || 0}` },
          lapsCount: { integerValue: `${record.lapsCount || 0}` },
          userEmail: { stringValue: record.userEmail || 'Local' },
          routeJson: { stringValue: JSON.stringify(sampledPoints) },
          lapsJson: { stringValue: JSON.stringify(laps) },
          createdAt: { integerValue: `${Date.now()}` },
        },
      }),
    });
    if (res.ok) {
      logAndSpeakCoach(`☁️ Entrenamiento sincronizado en Firebase Firestore (${firebaseConfig.projectId}).`);
    }
  } catch (err) {
    console.warn('Error subiendo entrenamiento a Firestore:', err);
  }
}

async function fetchWorkoutsFromFirebaseFirestore() {
  if (!isFirebaseReady()) return;
  try {
    const url = `${getFirestoreBaseUrl()}/workouts?pageSize=15&key=${encodeURIComponent(
      firebaseConfig.apiKey
    )}`;
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();
    if (!data.documents || data.documents.length === 0) return;

    const cloudWorkouts = data.documents.map((doc) => {
      const f = doc.fields || {};
      return {
        id: f.id?.stringValue || doc.name.split('/').pop(),
        date: f.date?.stringValue || '',
        sportName: f.sportName?.stringValue || '🏃 Entrenamiento',
        distanceKm: f.distanceKm?.stringValue || '0.00',
        duration: f.duration?.stringValue || '00:00',
        avgPace: f.avgPace?.stringValue || '--:--',
        calories: Number(f.calories?.integerValue || 0),
        lapsCount: Number(f.lapsCount?.integerValue || 0),
        userEmail: f.userEmail?.stringValue || 'Cloud',
        createdAt: Number(f.createdAt?.integerValue || 0),
      };
    });

    cloudWorkouts.sort((a, b) => b.createdAt - a.createdAt);
    localStorage.setItem('endomondo_neo_workouts', JSON.stringify(cloudWorkouts));
    renderSavedWorkouts();
  } catch (err) {
    console.warn('Error descargando entrenamientos de Firestore:', err);
  }
}

const seenCloudPeptalkIds = new Set();
let peptalkPollTimer = null;

async function pollLivePeptalksFromFirestore(initialLoad = false) {
  if (!isFirebaseReady()) return;
  try {
    const url = `${getFirestoreBaseUrl()}/workouts/live_global/peptalks?pageSize=20&key=${encodeURIComponent(
      firebaseConfig.apiKey
    )}`;
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();
    if (!data.documents) return;

    for (const doc of data.documents) {
      const docId = doc.name.split('/').pop();
      if (!seenCloudPeptalkIds.has(docId)) {
        seenCloudPeptalkIds.add(docId);
        if (!initialLoad) {
          const author = doc.fields?.authorName?.stringValue || 'Amigo';
          const message = doc.fields?.message?.stringValue || '';
          if (message) {
            logAndSpeakCoach(
              `💬 <strong>Peptalk Cloud de ${author}:</strong> "¡${message}!"`,
              'peptalk'
            );
          }
        }
      }
    }
  } catch {
    // Ignorar fallos temporales de red
  }
}

async function sendPeptalkToFirebaseFirestore(authorName, message) {
  if (!isFirebaseReady()) return;
  try {
    const url = `${getFirestoreBaseUrl()}/workouts/live_global/peptalks?key=${encodeURIComponent(
      firebaseConfig.apiKey
    )}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          authorName: { stringValue: authorName },
          message: { stringValue: message },
          userEmail: { stringValue: currentGoogleUser ? currentGoogleUser.email : 'Anon' },
          createdAt: { integerValue: `${Date.now()}` },
        },
      }),
    });
    if (res.ok) {
      const created = await res.json();
      if (created.name) {
        seenCloudPeptalkIds.add(created.name.split('/').pop());
      }
    }
  } catch (err) {
    console.warn('Error enviando Peptalk a Firestore:', err);
  }
}

// Iniciar escucha de Peptalks en la nube cada 4 segundos
void pollLivePeptalksFromFirestore(true);
peptalkPollTimer = setInterval(() => {
  void pollLivePeptalksFromFirestore(false);
}, 4000);

// Eventos del modal de configuración de Firebase
document.getElementById('btnFirebaseSetup').addEventListener('click', () => {
  if (firebaseConfig) {
    document.getElementById('firebaseProjectIdInput').value = firebaseConfig.projectId || '';
    document.getElementById('firebaseApiKeyInput').value = firebaseConfig.apiKey || '';
  }
  document.getElementById('firebaseConfigModal').classList.remove('hidden');
});

document.getElementById('btnCancelFirebaseModal').addEventListener('click', () => {
  document.getElementById('firebaseConfigModal').classList.add('hidden');
});

document.getElementById('firebaseRawSnippet').addEventListener('input', (e) => {
  const raw = e.target.value;
  const projMatch = raw.match(/projectId\s*:\s*["']([^"']+)["']/);
  const keyMatch = raw.match(/apiKey\s*:\s*["']([^"']+)["']/);
  if (projMatch) document.getElementById('firebaseProjectIdInput').value = projMatch[1];
  if (keyMatch) document.getElementById('firebaseApiKeyInput').value = keyMatch[1];
});

document.getElementById('firebaseConfigForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const projectId = document.getElementById('firebaseProjectIdInput').value.trim();
  const apiKey = document.getElementById('firebaseApiKeyInput').value.trim();
  if (!projectId || !apiKey) return;

  firebaseConfig = { projectId, apiKey };
  localStorage.setItem('endomondo_neo_firebase_config', JSON.stringify(firebaseConfig));
  document.getElementById('firebaseConfigModal').classList.add('hidden');
  renderFirebaseStatusUI();

  logAndSpeakCoach(`🔥 Backend Firebase conectado al proyecto ${projectId}. Sincronizando con Cloud Firestore.`);
  if (currentGoogleUser) {
    await syncUserProfileToFirebaseFirestore(currentGoogleUser);
  }
  const localWorkouts = JSON.parse(localStorage.getItem('endomondo_neo_workouts') || '[]');
  for (const w of localWorkouts.slice(0, 5)) {
    await syncWorkoutToFirebaseFirestore(w);
  }
  await fetchWorkoutsFromFirebaseFirestore();
});

// ============================================================================
// AUTENTICACIÓN CON CUENTA DE GOOGLE (NATIVO ANDROID + WEB OAUTH/MODAL)
// ============================================================================
let currentGoogleUser = JSON.parse(localStorage.getItem('endomondo_neo_google_user') || 'null');

function formatDisplayNameFromEmail(email) {
  const localPart = (email || 'Atleta').split('@')[0];
  return localPart
    .replace(/[._-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function applyGoogleUserSession(email, customName = '') {
  const cleanEmail = (email || '').trim().toLowerCase();
  if (!cleanEmail) return;
  const displayName = (customName || '').trim() || formatDisplayNameFromEmail(cleanEmail);
  const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(
    displayName
  )}&background=87c80a&color=091005&bold=true`;

  currentGoogleUser = {
    email: cleanEmail,
    displayName,
    avatarUrl,
    signedInAt: Date.now(),
  };
  localStorage.setItem('endomondo_neo_google_user', JSON.stringify(currentGoogleUser));
  renderGoogleAuthState();
  void syncUserProfileToFirebaseFirestore(currentGoogleUser);
  logAndSpeakCoach(`✅ Sesión iniciada con Google. ¡Bienvenido a Endomondo Neo, ${displayName}!`);
}

function renderGoogleAuthState() {
  const btnSignIn = document.getElementById('btnGoogleSignIn');
  const userPill = document.getElementById('googleUserPill');
  const syncBadge = document.getElementById('syncStatusBadge');

  if (currentGoogleUser) {
    btnSignIn.classList.add('hidden');
    userPill.classList.remove('hidden');
    document.getElementById('googleUserName').textContent = currentGoogleUser.displayName;
    document.getElementById('googleUserEmail').textContent = currentGoogleUser.email;
    document.getElementById('googleUserAvatar').src = currentGoogleUser.avatarUrl;
    if (syncBadge) {
      syncBadge.textContent = `☁️ Google Sync (${currentGoogleUser.email})`;
    }
  } else {
    btnSignIn.classList.remove('hidden');
    userPill.classList.add('hidden');
    if (syncBadge) {
      syncBadge.textContent = '💾 Local-First Activo';
    }
  }
}

// Callbacks invocados por MainActivity.java tras el selector nativo de cuentas Google de Android
window.onAndroidGoogleSignInSuccess = function (accountEmail) {
  applyGoogleUserSession(accountEmail);
};

window.onAndroidGoogleSignInFallback = function () {
  document.getElementById('googleAuthModal').classList.remove('hidden');
};

document.getElementById('btnGoogleSignIn').addEventListener('click', () => {
  if (window.AndroidBridge && typeof window.AndroidBridge.signInWithGoogle === 'function') {
    window.AndroidBridge.signInWithGoogle();
  } else {
    document.getElementById('googleAuthModal').classList.remove('hidden');
  }
});

document.getElementById('btnCancelGoogleModal').addEventListener('click', () => {
  document.getElementById('googleAuthModal').classList.add('hidden');
});

document.getElementById('googleAuthForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const email = document.getElementById('googleEmailInput').value;
  const name = document.getElementById('googleNameInput').value;
  document.getElementById('googleAuthModal').classList.add('hidden');
  applyGoogleUserSession(email, name);
});

document.getElementById('btnGoogleSignOut').addEventListener('click', () => {
  currentGoogleUser = null;
  localStorage.removeItem('endomondo_neo_google_user');
  renderGoogleAuthState();
  logAndSpeakCoach('ℹ️ Has cerrado la sesión de Google.');
});

// ============================================================================
// GOOGLE ANALYTICS 4 (G-3QDD46L6S4) & CRASHLYTICS ENGINE
// ============================================================================
let gaEventsCount = 0;
let crashReportsCount = 0;

function getDeviceMetadata() {
  if (window.AndroidBridge && typeof window.AndroidBridge.getDeviceInfoJson === 'function') {
    try {
      const info = JSON.parse(window.AndroidBridge.getDeviceInfoJson());
      return {
        platform: 'Android APK',
        device: `${info.manufacturer} ${info.model} (Android ${info.androidVersion}, API ${info.sdkInt})`,
        appVersion: info.appVersion || '1.4.0',
      };
    } catch {
      // Fallback
    }
  }
  return {
    platform: 'Web / PWA',
    device: navigator.userAgent.slice(0, 70),
    appVersion: '1.4.0',
  };
}

function appendTelemetryFeedItem(htmlText, isCrash = false) {
  const feed = document.getElementById('telemetryLiveFeed');
  if (!feed) return;
  const div = document.createElement('div');
  div.className = 'coach-msg';
  if (isCrash) {
    div.style.borderLeftColor = '#ef4444';
    div.style.background = 'rgba(239, 68, 68, 0.12)';
  }
  const ts = new Date().toLocaleTimeString('es-ES');
  div.innerHTML = `<span>[${ts}]</span> ${htmlText}`;
  feed.prepend(div);
}

function trackAnalyticsEvent(eventName, params = {}) {
  gaEventsCount += 1;
  const badge = document.getElementById('gaEventCountBadge');
  if (badge) badge.textContent = `${gaEventsCount} eventos`;

  const meta = getDeviceMetadata();
  const enrichedParams = {
    ...params,
    platform: meta.platform,
    user_email: currentGoogleUser ? currentGoogleUser.email : 'anonymous',
  };

  if (typeof window.gtag === 'function') {
    try {
      window.gtag('event', eventName, enrichedParams);
    } catch {
      // Ignorar si bloqueador de red
    }
  }

  appendTelemetryFeedItem(
    `📈 <strong>GA4 [G-3QDD46L6S4]</strong> <code>${eventName}</code> · ${JSON.stringify(params)}`
  );

  if (isFirebaseReady()) {
    const url = `${getFirestoreBaseUrl()}/analytics_events?key=${encodeURIComponent(
      firebaseConfig.apiKey
    )}`;
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          measurementId: { stringValue: 'G-3QDD46L6S4' },
          eventName: { stringValue: eventName },
          platform: { stringValue: meta.platform },
          device: { stringValue: meta.device },
          userEmail: { stringValue: enrichedParams.user_email },
          paramsJson: { stringValue: JSON.stringify(params) },
          timestamp: { integerValue: `${Date.now()}` },
        },
      }),
    }).catch(() => {});
  }
}

async function recordCrashlyticsException(message, stack = '', isFatal = false) {
  crashReportsCount += 1;
  const badge = document.getElementById('crashCountBadge');
  if (badge) badge.textContent = `${crashReportsCount} fallos`;

  const meta = getDeviceMetadata();
  const reportId = `crash-${Date.now()}`;

  if (typeof window.gtag === 'function') {
    try {
      window.gtag('event', 'exception', {
        description: message,
        fatal: isFatal,
      });
    } catch {
      // Ignorar
    }
  }

  appendTelemetryFeedItem(
    `🛡️ <strong>Crashlytics (${isFatal ? 'FATAL' : 'NON-FATAL'}):</strong> ${message} <br/><small style="color:#9ca3af">${meta.device}</small>`,
    true
  );

  if (isFirebaseReady()) {
    try {
      const url = `${getFirestoreBaseUrl()}/crashlytics_reports/${encodeURIComponent(
        reportId
      )}?key=${encodeURIComponent(firebaseConfig.apiKey)}`;
      await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: {
            id: { stringValue: reportId },
            message: { stringValue: String(message) },
            stack: { stringValue: String(stack || 'No stack trace') },
            isFatal: { booleanValue: Boolean(isFatal) },
            platform: { stringValue: meta.platform },
            device: { stringValue: meta.device },
            appVersion: { stringValue: meta.appVersion },
            userEmail: { stringValue: currentGoogleUser ? currentGoogleUser.email : 'anonymous' },
            workoutStatus: { stringValue: state.status },
            sportId: { stringValue: state.sportId },
            timestamp: { integerValue: `${Date.now()}` },
          },
        }),
      });
    } catch (e) {
      console.warn('No se pudo subir el reporte de Crashlytics:', e);
    }
  }
}

// Captura global de errores JavaScript y Promesas rechazadas para Crashlytics
window.addEventListener('error', (event) => {
  void recordCrashlyticsException(
    event.message || 'Uncaught JS Error',
    `${event.filename || ''}:${event.lineno || 0}:${event.colno || 0}`,
    false
  );
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason ? String(event.reason) : 'Unhandled Promise Rejection';
  void recordCrashlyticsException(reason, 'Promise Rejection', false);
});

// Comprobar si hubo algún crash nativo de Java en la sesión anterior de Android
if (
  window.AndroidBridge &&
  typeof window.AndroidBridge.consumePendingNativeCrashJson === 'function'
) {
  try {
    const rawCrash = window.AndroidBridge.consumePendingNativeCrashJson();
    if (rawCrash) {
      const parsed = JSON.parse(rawCrash);
      void recordCrashlyticsException(
        `[Android Native Java Crash] ${parsed.message}`,
        parsed.stack,
        true
      );
    }
  } catch {
    // Ignorar
  }
}

document.getElementById('btnTelemetryPanel').addEventListener('click', () => {
  const meta = getDeviceMetadata();
  const devLabel = document.getElementById('crashDeviceLabel');
  if (devLabel) devLabel.textContent = meta.device;
  document.getElementById('telemetryModal').classList.remove('hidden');
});

document.getElementById('btnCloseTelemetryModal').addEventListener('click', () => {
  document.getElementById('telemetryModal').classList.add('hidden');
});

document.getElementById('btnTestCrashlytics').addEventListener('click', async () => {
  const fakeError = new Error(
    'TestCrashlyticsException: Simulación de fallo en sensor GPS/BLE durante entrenamiento'
  );
  await recordCrashlyticsException(fakeError.message, fakeError.stack || '', false);
  logAndSpeakCoach(
    '🛡️ Reporte de fallo enviado a Firebase Crashlytics (colección crashlytics_reports) y Google Analytics.'
  );
});

// ============================================================================
// COMUNIDAD SOCIAL ENDOMONDO NEO: AMIGOS, AVANCES EN FIREBASE Y LOGROS (PRs)
// ============================================================================
const DEFAULT_FRIENDS = [
  {
    name: 'Carlos Martínez',
    email: 'carlos.runner@gmail.com',
    totalKm: 42.6,
    totalCalories: 3180,
    workoutsCount: 5,
    lastActivity: '🏃 Correr · 10.40 km en 49:15 (4:44/km)',
    badges: ['🏅 Finisher 10K', '⚡ Sub-5:00/km', '💙 Polar H10'],
  },
  {
    name: 'Laura Gómez',
    email: 'laura.trail@gmail.com',
    totalKm: 36.2,
    totalCalories: 2890,
    workoutsCount: 4,
    lastActivity: '⛰️ Trail Running · 12.10 km (+420m) en 1:08:20',
    badges: ['🏔️ Escaladora +400m', '🔥 Quema-Calorías'],
  },
  {
    name: 'Miguel Ángel',
    email: 'miguel.bici@gmail.com',
    totalKm: 88.5,
    totalCalories: 2450,
    workoutsCount: 3,
    lastActivity: '🚴 Ciclismo en Ruta · 45.00 km en 1:32:10',
    badges: ['🚴 Rodador 40K', '⚡ Potenciómetro 250W'],
  },
];

const ACHIEVEMENTS_CATALOG = [
  { id: 'first_workout', icon: '🚀', title: 'Debutante Endomondo', desc: 'Completa y guarda tu primer entrenamiento GPS.' },
  { id: 'ble_heart', icon: '💙', title: 'Corazón Conectado', desc: 'Conecta una banda o reloj de pulso Bluetooth LE.' },
  { id: 'distance_5k', icon: '🏅', title: 'Finisher 5K', desc: 'Alcanza 5 kilómetros en un entrenamiento o acumulado.' },
  { id: 'calories_300', icon: '🔥', title: 'Quema-Calorías', desc: 'Supera las 300 kcal quemadas.' },
  { id: 'pace_sub5', icon: '⚡', title: 'Misil Sub-5:00/km', desc: 'Completa un kilómetro por debajo de 5:00 min/km.' },
  { id: 'climber_100', icon: '🏔️', title: 'Rey de la Montaña', desc: 'Acumula más de 100 metros de ascenso positivo.' },
  { id: 'social_club', icon: '🤝', title: 'Club Social Endomondo', desc: 'Añade un amigo o compite en el ranking semanal.' },
  { id: 'peptalk_sender', icon: '🎙️', title: 'Motivador en Vivo', desc: 'Envía un Peptalk de ánimo a un amigo en carrera.' },
];

let friendsList = JSON.parse(localStorage.getItem('endomondo_neo_friends') || 'null') || DEFAULT_FRIENDS;
let unlockedAchievements = new Set(
  JSON.parse(localStorage.getItem('endomondo_neo_achievements') || '["first_workout"]')
);

function unlockAchievement(achievementId) {
  if (unlockedAchievements.has(achievementId)) return;
  unlockedAchievements.add(achievementId);
  localStorage.setItem(
    'endomondo_neo_achievements',
    JSON.stringify(Array.from(unlockedAchievements))
  );
  const meta = ACHIEVEMENTS_CATALOG.find((a) => a.id === achievementId);
  if (meta) {
    logAndSpeakCoach(`🏆 ¡Nuevo logro desbloqueado!: ${meta.title} (${meta.desc})`);
    if (typeof trackAnalyticsEvent === 'function') {
      trackAnalyticsEvent('unlock_achievement', { achievement_id: achievementId });
    }
  }
  renderSocialHub();
}

function evaluateWorkoutAchievements() {
  unlockAchievement('first_workout');
  const saved = JSON.parse(localStorage.getItem('endomondo_neo_workouts') || '[]');
  const totalKm = saved.reduce((acc, w) => acc + ( parseFloat(w.distanceKm) || 0 ), 0);
  const totalCal = saved.reduce((acc, w) => acc + ( Number(w.calories) || 0 ), 0);
  if (totalKm >= 5 || state.distanceMeters >= 5000) unlockAchievement('distance_5k');
  if (totalCal >= 300 || state.caloriesKcal >= 300) unlockAchievement('calories_300');
  if (state.elevationGainMeters >= 100) unlockAchievement('climber_100');
  if (state.laps.some((l) => l.paceSecPerKm > 0 && l.paceSecPerKm < 300)) {
    unlockAchievement('pace_sub5');
  }
}

function renderSocialHub() {
  // 1. Calcular mis estadísticas acumuladas para el Ranking
  const saved = JSON.parse(localStorage.getItem('endomondo_neo_workouts') || '[]');
  const myTotalKm = saved.reduce((acc, w) => acc + (parseFloat(w.distanceKm) || 0), 0);
  const myTotalCal = saved.reduce((acc, w) => acc + (Number(w.calories) || 0), 0);
  const myName = currentGoogleUser ? `${currentGoogleUser.displayName} (Tú)` : 'Tú (Atleta Local)';
  const myEmail = currentGoogleUser ? currentGoogleUser.email : 'tu.cuenta@gmail.com';

  const allCompetitors = [
    {
      name: myName,
      email: myEmail,
      totalKm: Number(myTotalKm.toFixed(2)),
      totalCalories: myTotalCal,
      workoutsCount: saved.length,
      isMe: true,
      lastActivity: saved[0]
        ? `${saved[0].sportName} · ${saved[0].distanceKm} km en ${saved[0].duration}`
        : 'Listo para entrenar',
    },
    ...friendsList,
  ].sort((a, b) => b.totalKm - a.totalKm);

  const rankContainer = document.getElementById('friendsLeaderboardList');
  if (rankContainer) {
    rankContainer.innerHTML = allCompetitors
      .map((c, idx) => {
        const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`;
        return `
          <div class="saved-item" style="${c.isMe ? 'border-color:#87c80a;background:rgba(135,200,10,0.09);' : ''}">
            <div>
              <strong>${medal} ${c.name}</strong>
              <div style="font-size:11px;color:#9ca3af">${c.email} · ${c.workoutsCount} entrenamientos</div>
            </div>
            <div style="text-align:right">
              <strong style="color:#87c80a;font-size:14px;">${c.totalKm.toFixed(1)} km</strong>
              <div style="font-size:11px;color:#fb923c">🔥 ${c.totalCalories} kcal</div>
            </div>
          </div>
        `;
      })
      .join('');
  }

  // 2. Renderizar Feed de Avances de Amigos
  const feedContainer = document.getElementById('friendsActivityFeed');
  if (feedContainer) {
    feedContainer.innerHTML = allCompetitors
      .map(
        (c) => `
        <div class="saved-item">
          <div>
            <strong>${c.name}</strong>
            <div style="font-size:12px;color:#e5e7eb;margin:2px 0;">${c.lastActivity}</div>
            <div style="font-size:10px;color:#87c80a;">${(c.badges || ['🏅 Atleta Endomondo']).join(' · ')}</div>
          </div>
          <div style="display:flex;gap:6px;">
            <button type="button" class="chip-btn active" onclick="window.sendHighFiveToFriend('${c.name.replace(/'/g, '')}')">👏 Choca esos 5</button>
          </div>
        </div>
      `
      )
      .join('');
  }

  // 3. Renderizar Vitrina de Logros (Achievements)
  const achContainer = document.getElementById('achievementsGrid');
  if (achContainer) {
    achContainer.innerHTML = ACHIEVEMENTS_CATALOG.map((a) => {
      const isUnlocked = unlockedAchievements.has(a.id);
      return `
        <div class="achievement-card ${isUnlocked ? 'unlocked' : ''}">
          <div class="achievement-icon">${isUnlocked ? a.icon : '🔒'}</div>
          <div>
            <strong style="color:${isUnlocked ? '#87c80a' : '#9ca3af'}">${a.title}</strong>
            <div style="color:#9ca3af;font-size:10px;">${a.desc}</div>
          </div>
        </div>
      `;
    }).join('');
  }
}

window.sendHighFiveToFriend = function (friendName) {
  unlockAchievement('peptalk_sender');
  const author = currentGoogleUser ? currentGoogleUser.displayName : 'Tu amigo';
  const msg = `👏 ¡${author} ha chocado esos cinco con ${friendName} por su último entrenamiento!`;
  logAndSpeakCoach(msg, 'peptalk');
  void sendPeptalkToFirebaseFirestore(author, `¡Choca esos cinco, ${friendName}! Gran entreno.`);
};

document.getElementById('btnFriendsHub').addEventListener('click', () => {
  evaluateWorkoutAchievements();
  renderSocialHub();
  document.getElementById('friendsModal').classList.remove('hidden');
});

document.getElementById('btnCloseFriendsModal').addEventListener('click', () => {
  document.getElementById('friendsModal').classList.add('hidden');
});

document.querySelectorAll('.social-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.social-tab').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.socialTab;
    document.getElementById('socialTabRanking').classList.toggle('hidden', tab !== 'ranking');
    document.getElementById('socialTabFeed').classList.toggle('hidden', tab !== 'feed');
    document.getElementById('socialTabAchievements').classList.toggle('hidden', tab !== 'achievements');
  });
});

document.getElementById('addFriendForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('friendNameInput').value.trim();
  const email = document.getElementById('friendEmailInput').value.trim().toLowerCase();
  if (!name || !email) return;

  const newFriend = {
    name,
    email,
    totalKm: Number((10 + Math.random() * 25).toFixed(1)),
    totalCalories: Math.round(800 + Math.random() * 1400),
    workoutsCount: Math.max(1, Math.floor(Math.random() * 4)),
    lastActivity: '🏃 Entrenamiento sincronizado en Firebase Endomondo Neo',
    badges: ['🤝 Nuevo Amigo', '🏅 Comunidad Endomondo'],
  };
  friendsList.unshift(newFriend);
  localStorage.setItem('endomondo_neo_friends', JSON.stringify(friendsList));
  unlockAchievement('social_club');
  renderSocialHub();

  document.getElementById('friendNameInput').value = '';
  document.getElementById('friendEmailInput').value = '';

  if (isFirebaseReady()) {
    const url = `${getFirestoreBaseUrl()}/users/${encodeURIComponent(email)}?key=${encodeURIComponent(
      firebaseConfig.apiKey
    )}`;
    fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          email: { stringValue: email },
          displayName: { stringValue: name },
          addedBy: { stringValue: currentGoogleUser ? currentGoogleUser.email : 'local' },
          updatedAt: { integerValue: `${Date.now()}` },
        },
      }),
    }).catch(() => {});
  }
  logAndSpeakCoach(`👥 Has añadido a ${name} a tu lista de amigos de Endomondo Neo.`);
});

document.getElementById('btnSyncFriendsCloud').addEventListener('click', async () => {
  await fetchWorkoutsFromFirebaseFirestore();
  evaluateWorkoutAchievements();
  renderSocialHub();
  logAndSpeakCoach('🔄 Avances y entrenamientos de amigos sincronizados desde Firebase Firestore.');
});

// Inicializar vista al cargar
renderFirebaseStatusUI();
renderGoogleAuthState();
renderAllMetrics();
renderSavedWorkouts();
renderSocialHub();
trackAnalyticsEvent('app_open', { sport_default: state.sportId });
if (isFirebaseReady()) {
  void fetchWorkoutsFromFirebaseFirestore();
}

// Centrar el mapa automáticamente en la ubicación GPS real del móvil al abrir la app
if ('geolocation' in navigator) {
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      simLat = latitude;
      simLon = longitude;
      map.setView([latitude, longitude], 16);
      if (!currentMarker) {
        currentMarker = L.circleMarker([latitude, longitude], {
          radius: 8,
          fillColor: '#87c80a',
          color: '#ffffff',
          weight: 2,
          fillOpacity: 1,
        }).addTo(map);
      } else {
        currentMarker.setLatLng([latitude, longitude]);
      }
    },
    () => {},
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
if ('wakeLock' in navigator) {
  navigator.wakeLock.request('screen').catch(() => {});
}

