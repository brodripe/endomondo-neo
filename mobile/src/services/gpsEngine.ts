import { ENDOMONDO_SPORTS } from '../constants/sports';
import {
  LiveWorkoutState,
  SportId,
  TrackPoint,
  WorkoutLap,
} from '../types/workout';

const EARTH_RADIUS_M = 6371000;
const LAP_DISTANCE_METERS = 1000;

/**
 * Filtro de Kalman 1D ligero para suavizar latitud, longitud y altitud GPS
 * eliminando saltos espurios en zonas urbanas o arboladas.
 */
class SimpleKalman1D {
  private estimate: number | null = null;
  private errorEstimate = 1.0;

  constructor(private readonly processNoise = 0.00001) {}

  filter(measurement: number, measurementError: number): number {
    if (this.estimate === null) {
      this.estimate = measurement;
      this.errorEstimate = measurementError;
      return measurement;
    }
    const priorError = this.errorEstimate + this.processNoise;
    const kalmanGain = priorError / (priorError + Math.max(measurementError, 0.0001));
    this.estimate = this.estimate + kalmanGain * (measurement - this.estimate);
    this.errorEstimate = (1 - kalmanGain) * priorError;
    return this.estimate;
  }

  reset(): void {
    this.estimate = null;
    this.errorEstimate = 1.0;
  }
}

export interface RawSensorSample {
  timestamp: number;
  latitude: number;
  longitude: number;
  altitude: number | null;
  accuracyMeters: number;
  nativeSpeedMs: number | null;
  heartRateBpm: number | null;
  cadenceSpm: number | null;
  powerWatts: number | null;
}

export interface GpsEngineCallbacks {
  onLapCompleted?: (lap: WorkoutLap, state: LiveWorkoutState) => void;
  onAutoPauseChanged?: (isAutoPaused: boolean, state: LiveWorkoutState) => void;
  onPersonalRecord?: (recordName: string, durationSec: number) => void;
}

export class EndomondoGpsEngine {
  private latFilter = new SimpleKalman1D(0.000005);
  private lonFilter = new SimpleKalman1D(0.000005);
  private altFilter = new SimpleKalman1D(0.15);

  private lowSpeedStreakCount = 0;
  private resumeSpeedStreakCount = 0;
  private lastLapSplitDistanceMeters = 0;
  private lastLapSplitActiveSec = 0;
  private lastLapStartElevation: number | null = null;
  private userWeightKg = 72;

  constructor(
    private callbacks: GpsEngineCallbacks = {},
    private autoPauseEnabled = true
  ) {}

  setAutoPauseEnabled(enabled: boolean): void {
    this.autoPauseEnabled = enabled;
  }

  setUserWeightKg(weightKg: number): void {
    this.userWeightKg = weightKg;
  }

  resetFilters(): void {
    this.latFilter.reset();
    this.lonFilter.reset();
    this.altFilter.reset();
    this.lowSpeedStreakCount = 0;
    this.resumeSpeedStreakCount = 0;
    this.lastLapSplitDistanceMeters = 0;
    this.lastLapSplitActiveSec = 0;
    this.lastLapStartElevation = null;
  }

  /**
   * Calcula distancia Haversine 2D y aplica corrección 3D cuando hay altitud fiable.
   */
  static calculateDistanceMeters(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
    altDelta = 0
  ): number {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const horizontalDist = EARTH_RADIUS_M * c;
    return Math.sqrt(horizontalDist * horizontalDist + altDelta * altDelta);
  }

  /**
   * Procesa una nueva muestra de GPS + Sensores BLE y actualiza el estado del entrenamiento.
   */
  ingestSample(
    prevState: LiveWorkoutState,
    sample: RawSensorSample
  ): LiveWorkoutState {
    if (
      prevState.status === 'idle' ||
      prevState.status === 'manual_paused' ||
      prevState.status === 'completed'
    ) {
      return prevState;
    }

    // Descartar lecturas con mala precisión horizontal (> 35 metros)
    if (sample.accuracyMeters > 35) {
      return prevState;
    }

    const sportDef = ENDOMONDO_SPORTS[prevState.sportId];
    const normError = Math.max(sample.accuracyMeters / 100000, 0.00001);
    const smoothLat = this.latFilter.filter(sample.latitude, normError);
    const smoothLon = this.lonFilter.filter(sample.longitude, normError);
    const smoothAlt =
      sample.altitude !== null
        ? this.altFilter.filter(sample.altitude, 1.5)
        : prevState.currentAltitudeMeters;

    const lastPoint =
      prevState.points.length > 0
        ? prevState.points[prevState.points.length - 1]
        : null;

    if (!lastPoint) {
      this.lastLapStartElevation = smoothAlt;
      const firstPoint: TrackPoint = {
        timestamp: sample.timestamp,
        latitude: smoothLat,
        longitude: smoothLon,
        altitude: smoothAlt,
        accuracyMeters: sample.accuracyMeters,
        speedMs: sample.nativeSpeedMs ?? 0,
        paceSecPerKm: 0,
        gradePercent: 0,
        heartRateBpm: sample.heartRateBpm,
        cadenceSpm: sample.cadenceSpm,
        powerWatts: sample.powerWatts,
        cumulativeDistanceMeters: 0,
        isAutoPaused: false,
      };
      return {
        ...prevState,
        currentAltitudeMeters: smoothAlt,
        currentHeartRateBpm: sample.heartRateBpm,
        currentCadenceSpm: sample.cadenceSpm,
        points: [firstPoint],
      };
    }

    const dtSec = Math.max((sample.timestamp - lastPoint.timestamp) / 1000, 0.5);
    const altDelta =
      smoothAlt !== null && lastPoint.altitude !== null
        ? smoothAlt - lastPoint.altitude
        : 0;

    const rawStepMeters = EndomondoGpsEngine.calculateDistanceMeters(
      lastPoint.latitude,
      lastPoint.longitude,
      smoothLat,
      smoothLon,
      altDelta
    );

    const calculatedSpeedMs = rawStepMeters / dtSec;
    const effectiveSpeedMs =
      sample.nativeSpeedMs !== null && sample.nativeSpeedMs >= 0
        ? sample.nativeSpeedMs * 0.65 + calculatedSpeedMs * 0.35
        : calculatedSpeedMs;

    // Lógica de Auto-Pausa con histéresis para evitar rebotes en semáforos
    let nextStatus = prevState.status;
    if (this.autoPauseEnabled) {
      if (effectiveSpeedMs < sportDef.autoPauseSpeedThresholdMs) {
        this.lowSpeedStreakCount += 1;
        this.resumeSpeedStreakCount = 0;
        if (this.lowSpeedStreakCount >= 3 && prevState.status === 'active') {
          nextStatus = 'auto_paused';
        }
      } else {
        this.resumeSpeedStreakCount += 1;
        this.lowSpeedStreakCount = 0;
        if (this.resumeSpeedStreakCount >= 2 && prevState.status === 'auto_paused') {
          nextStatus = 'active';
        }
      }
    } else if (prevState.status === 'auto_paused') {
      nextStatus = 'active';
    }

    const isAutoPaused = nextStatus === 'auto_paused';
    const stepDistance = isAutoPaused || rawStepMeters < 0.4 ? 0 : rawStepMeters;
    const newDistanceMeters = prevState.distanceMeters + stepDistance;
    const newActiveDurationSec = isAutoPaused
      ? prevState.activeDurationSec
      : prevState.activeDurationSec + dtSec;

    // Ganancia y pérdida de altitud con umbral de 0.8m para filtrar ruido barométrico
    let newElevationGain = prevState.elevationGainMeters;
    let newElevationLoss = prevState.elevationLossMeters;
    if (!isAutoPaused && Math.abs(altDelta) >= 0.35) {
      if (altDelta > 0) newElevationGain += altDelta;
      else newElevationLoss += Math.abs(altDelta);
    }

    const gradePercent =
      stepDistance > 1.5 ? (altDelta / stepDistance) * 100 : 0;

    const currentPaceSecPerKm =
      effectiveSpeedMs > 0.35 ? 1000 / effectiveSpeedMs : 0;
    const avgPaceSecPerKm =
      newDistanceMeters > 25
        ? (newActiveDurationSec / newDistanceMeters) * 1000
        : 0;

    // Ritmo de la vuelta actual
    const distInCurrentLap = newDistanceMeters - this.lastLapSplitDistanceMeters;
    const timeInCurrentLap = newActiveDurationSec - this.lastLapSplitActiveSec;
    const currentLapPaceSecPerKm =
      distInCurrentLap > 15 ? (timeInCurrentLap / distInCurrentLap) * 1000 : currentPaceSecPerKm;

    // Cálculo de calorías e hidratación (fórmula clásica Endomondo + corrección por pendiente)
    const gradeMultiplier = gradePercent > 0 ? 1 + gradePercent * 0.035 : 1;
    const hoursActive = newActiveDurationSec / 3600;
    const caloriesKcal = Math.round(
      sportDef.baseMet * gradeMultiplier * this.userWeightKg * hoursActive
    );
    const hydrationNeedsMl = Math.round(caloriesKcal * 1.15);

    const newPoint: TrackPoint = {
      timestamp: sample.timestamp,
      latitude: smoothLat,
      longitude: smoothLon,
      altitude: smoothAlt,
      accuracyMeters: sample.accuracyMeters,
      speedMs: isAutoPaused ? 0 : effectiveSpeedMs,
      paceSecPerKm: isAutoPaused ? 0 : currentPaceSecPerKm,
      gradePercent,
      heartRateBpm: sample.heartRateBpm,
      cadenceSpm: sample.cadenceSpm,
      powerWatts: sample.powerWatts,
      cumulativeDistanceMeters: newDistanceMeters,
      isAutoPaused,
    };

    const allPoints = [...prevState.points, newPoint];

    // Promedio y máximo de Frecuencia Cardíaca
    const hrSamples = allPoints
      .map((p) => p.heartRateBpm)
      .filter((hr): hr is number => hr !== null && hr > 30);
    const avgHeartRateBpm =
      hrSamples.length > 0
        ? Math.round(hrSamples.reduce((a, b) => a + b, 0) / hrSamples.length)
        : null;
    const maxHeartRateBpm =
      hrSamples.length > 0 ? Math.max(...hrSamples) : null;

    // Verificar si se completó un nuevo kilómetro (Lap Split)
    const updatedLaps = [...prevState.laps];
    let completedLap: WorkoutLap | null = null;

    if (
      newDistanceMeters - this.lastLapSplitDistanceMeters >=
      LAP_DISTANCE_METERS
    ) {
      const lapNumber = updatedLaps.length + 1;
      const lapDurationSec = Math.max(
        newActiveDurationSec - this.lastLapSplitActiveSec,
        1
      );
      const lapPaceSecPerKm = (lapDurationSec / LAP_DISTANCE_METERS) * 1000;
      const lapElevDelta =
        smoothAlt !== null && this.lastLapStartElevation !== null
          ? smoothAlt - this.lastLapStartElevation
          : 0;

      completedLap = {
        lapNumber,
        distanceMeters: LAP_DISTANCE_METERS,
        durationSec: Math.round(lapDurationSec),
        paceSecPerKm: Math.round(lapPaceSecPerKm),
        elevationDeltaMeters: Math.round(lapElevDelta),
        avgHeartRateBpm: sample.heartRateBpm ?? avgHeartRateBpm,
        avgCadenceSpm: sample.cadenceSpm,
        splitTimestamp: sample.timestamp,
      };

      updatedLaps.push(completedLap);
      this.lastLapSplitDistanceMeters += LAP_DISTANCE_METERS;
      this.lastLapSplitActiveSec = newActiveDurationSec;
      this.lastLapStartElevation = smoothAlt;
    }

    const nextState: LiveWorkoutState = {
      ...prevState,
      status: nextStatus,
      activeDurationSec: newActiveDurationSec,
      totalElapsedSec:
        prevState.startedAt !== null
          ? Math.round((sample.timestamp - prevState.startedAt) / 1000)
          : newActiveDurationSec,
      distanceMeters: newDistanceMeters,
      currentSpeedMs: isAutoPaused ? 0 : effectiveSpeedMs,
      currentPaceSecPerKm: isAutoPaused ? 0 : currentPaceSecPerKm,
      avgPaceSecPerKm,
      currentLapPaceSecPerKm,
      elevationGainMeters: newElevationGain,
      elevationLossMeters: newElevationLoss,
      currentAltitudeMeters: smoothAlt,
      caloriesKcal,
      hydrationNeedsMl,
      currentHeartRateBpm: sample.heartRateBpm,
      avgHeartRateBpm,
      maxHeartRateBpm,
      currentCadenceSpm: sample.cadenceSpm,
      points: allPoints,
      laps: updatedLaps,
    };

    if (prevState.status !== nextStatus) {
      this.callbacks.onAutoPauseChanged?.(isAutoPaused, nextState);
    }

    if (completedLap) {
      this.callbacks.onLapCompleted?.(completedLap, nextState);
    }

    return nextState;
  }
}
