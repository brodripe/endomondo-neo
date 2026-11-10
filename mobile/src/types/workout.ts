export type SportId =
  | 'running'
  | 'trail_running'
  | 'cycling_road'
  | 'cycling_mtb'
  | 'walking'
  | 'hiking'
  | 'kayaking'
  | 'roller_skating'
  | 'xc_skiing'
  | 'swimming_open';

export type MetricTileKey =
  | 'duration'
  | 'distance'
  | 'pace_current'
  | 'pace_avg'
  | 'pace_lap'
  | 'speed_kmh'
  | 'heart_rate'
  | 'calories'
  | 'elevation_gain'
  | 'cadence'
  | 'hydration_ml';

export type WorkoutStatus = 'idle' | 'active' | 'auto_paused' | 'manual_paused' | 'completed';

export interface SportDefinition {
  id: SportId;
  nameEs: string;
  icon: string;
  baseMet: number;
  usesPaceInsteadOfSpeed: boolean;
  /** Velocidad mínima (m/s) por debajo de la cual se activa Auto-Pausa tras histéresis */
  autoPauseSpeedThresholdMs: number;
  defaultGridMetrics: [MetricTileKey, MetricTileKey, MetricTileKey, MetricTileKey];
}

export interface TrackPoint {
  timestamp: number;
  latitude: number;
  longitude: number;
  altitude: number | null;
  accuracyMeters: number;
  speedMs: number;
  paceSecPerKm: number;
  gradePercent: number;
  heartRateBpm: number | null;
  cadenceSpm: number | null;
  powerWatts: number | null;
  cumulativeDistanceMeters: number;
  isAutoPaused: boolean;
}

export interface WorkoutLap {
  lapNumber: number;
  distanceMeters: number;
  durationSec: number;
  paceSecPerKm: number;
  elevationDeltaMeters: number;
  avgHeartRateBpm: number | null;
  avgCadenceSpm: number | null;
  splitTimestamp: number;
}

export interface PeptalkMessage {
  id: string;
  workoutId: string;
  authorName: string;
  message: string;
  createdAt: number;
  spokenByCoach: boolean;
}

export interface AudioCoachSettings {
  enabled: boolean;
  language: 'es-ES' | 'en-US';
  voiceRate: number;
  announceEveryKm: boolean;
  announceLapPace: boolean;
  announceHeartRateZone: boolean;
  announceTargetGhostDelta: boolean;
  announceAutoPause: boolean;
  readLivePeptalks: boolean;
  targetPaceSecPerKm: number | null; // Ej. 300 = 5:00 min/km (Meta / Ghost)
}

export interface LiveWorkoutState {
  workoutId: string;
  sportId: SportId;
  status: WorkoutStatus;
  startedAt: number | null;
  activeDurationSec: number;
  totalElapsedSec: number;
  distanceMeters: number;
  currentSpeedMs: number;
  currentPaceSecPerKm: number;
  avgPaceSecPerKm: number;
  currentLapPaceSecPerKm: number;
  elevationGainMeters: number;
  elevationLossMeters: number;
  currentAltitudeMeters: number | null;
  caloriesKcal: number;
  hydrationNeedsMl: number;
  currentHeartRateBpm: number | null;
  avgHeartRateBpm: number | null;
  maxHeartRateBpm: number | null;
  currentCadenceSpm: number | null;
  points: TrackPoint[];
  laps: WorkoutLap[];
  peptalks: PeptalkMessage[];
  personalRecordsBroken: string[];
}
