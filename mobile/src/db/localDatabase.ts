import * as SQLite from 'expo-sqlite';
import { LiveWorkoutState, TrackPoint, WorkoutLap } from '../types/workout';

/**
 * MOTOR LOCAL-FIRST SQLITE (expo-sqlite)
 * Almacena cada punto GPS (1Hz), vuelta y entrenamiento directamente en el dispositivo
 * en modo WAL (Write-Ahead Logging) para evitar cualquier pérdida de datos sin cobertura
 * o ante un cierre inesperado, y mantiene una cola de salida (sync_queue) hacia Supabase.
 */
export class LocalWorkoutDatabase {
  private db: SQLite.SQLiteDatabase | null = null;

  async init(): Promise<void> {
    this.db = await SQLite.openDatabaseAsync('endomondo_neo_local.db');
    await this.db.execAsync(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;

      CREATE TABLE IF NOT EXISTS workouts (
        id TEXT PRIMARY KEY NOT NULL,
        sport_id TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        active_duration_sec REAL NOT NULL DEFAULT 0,
        distance_meters REAL NOT NULL DEFAULT 0,
        avg_pace_sec_per_km REAL DEFAULT 0,
        elevation_gain_m REAL DEFAULT 0,
        elevation_loss_m REAL DEFAULT 0,
        calories_kcal INTEGER DEFAULT 0,
        hydration_ml INTEGER DEFAULT 0,
        avg_hr_bpm INTEGER,
        max_hr_bpm INTEGER,
        synced_to_cloud INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS track_points (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workout_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        altitude REAL,
        accuracy_m REAL,
        speed_ms REAL,
        pace_sec_per_km REAL,
        grade_percent REAL,
        heart_rate_bpm INTEGER,
        cadence_spm INTEGER,
        power_watts INTEGER,
        cumulative_distance_m REAL,
        is_auto_paused INTEGER DEFAULT 0,
        FOREIGN KEY (workout_id) REFERENCES workouts(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_points_workout_ts
        ON track_points(workout_id, timestamp);

      CREATE TABLE IF NOT EXISTS workout_laps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workout_id TEXT NOT NULL,
        lap_number INTEGER NOT NULL,
        distance_meters REAL NOT NULL,
        duration_sec REAL NOT NULL,
        pace_sec_per_km REAL NOT NULL,
        elevation_delta_m REAL DEFAULT 0,
        avg_hr_bpm INTEGER,
        split_timestamp INTEGER NOT NULL,
        UNIQUE(workout_id, lap_number)
      );

      CREATE TABLE IF NOT EXISTS sync_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  async upsertWorkoutSnapshot(state: LiveWorkoutState): Promise<void> {
    if (!this.db || !state.startedAt) return;
    await this.db.runAsync(
      `INSERT INTO workouts (
        id, sport_id, status, started_at, ended_at,
        active_duration_sec, distance_meters, avg_pace_sec_per_km,
        elevation_gain_m, elevation_loss_m, calories_kcal, hydration_ml,
        avg_hr_bpm, max_hr_bpm, synced_to_cloud
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        ended_at = excluded.ended_at,
        active_duration_sec = excluded.active_duration_sec,
        distance_meters = excluded.distance_meters,
        avg_pace_sec_per_km = excluded.avg_pace_sec_per_km,
        elevation_gain_m = excluded.elevation_gain_m,
        elevation_loss_m = excluded.elevation_loss_m,
        calories_kcal = excluded.calories_kcal,
        hydration_ml = excluded.hydration_ml,
        avg_hr_bpm = excluded.avg_hr_bpm,
        max_hr_bpm = excluded.max_hr_bpm,
        synced_to_cloud = 0;`,
      [
        state.workoutId,
        state.sportId,
        state.status,
        state.startedAt,
        state.status === 'completed' ? Date.now() : null,
        state.activeDurationSec,
        state.distanceMeters,
        state.avgPaceSecPerKm,
        state.elevationGainMeters,
        state.elevationLossMeters,
        state.caloriesKcal,
        state.hydrationNeedsMl,
        state.avgHeartRateBpm,
        state.maxHeartRateBpm,
      ]
    );
  }

  async insertTrackPoint(workoutId: string, pt: TrackPoint): Promise<void> {
    if (!this.db) return;
    await this.db.runAsync(
      `INSERT INTO track_points (
        workout_id, timestamp, latitude, longitude, altitude, accuracy_m,
        speed_ms, pace_sec_per_km, grade_percent, heart_rate_bpm,
        cadence_spm, power_watts, cumulative_distance_m, is_auto_paused
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        workoutId,
        pt.timestamp,
        pt.latitude,
        pt.longitude,
        pt.altitude,
        pt.accuracyMeters,
        pt.speedMs,
        pt.paceSecPerKm,
        pt.gradePercent,
        pt.heartRateBpm,
        pt.cadenceSpm,
        pt.powerWatts,
        pt.cumulativeDistanceMeters,
        pt.isAutoPaused ? 1 : 0,
      ]
    );
  }

  async insertLap(workoutId: string, lap: WorkoutLap): Promise<void> {
    if (!this.db) return;
    await this.db.runAsync(
      `INSERT OR REPLACE INTO workout_laps (
        workout_id, lap_number, distance_meters, duration_sec,
        pace_sec_per_km, elevation_delta_m, avg_hr_bpm, split_timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        workoutId,
        lap.lapNumber,
        lap.distanceMeters,
        lap.durationSec,
        lap.paceSecPerKm,
        lap.elevationDeltaMeters,
        lap.avgHeartRateBpm,
        lap.splitTimestamp,
      ]
    );
  }

  async enqueueForCloudSync(
    entityType: 'workout_completed' | 'lap_split',
    entityId: string,
    payload: unknown
  ): Promise<void> {
    if (!this.db) return;
    await this.db.runAsync(
      `INSERT INTO sync_queue (entity_type, entity_id, payload_json, created_at)
       VALUES (?, ?, ?, ?);`,
      [entityType, entityId, JSON.stringify(payload), Date.now()]
    );
  }
}
