import { createClient, RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { LiveWorkoutState, PeptalkMessage, TrackPoint } from '../types/workout';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://your-project.supabase.co';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? 'public-anon-key';

/**
 * SERVICIO DE SINCRONIZACIÓN Y TELEMETRÍA EN VIVO (SUPABASE REALTIME + POSTGIS)
 * 1. Emite posición GPS en tiempo real para que amigos sigan tu entrenamiento.
 * 2. Escucha nuevos Peptalks en la tabla `peptalks` para que el Audio Coach los lea al instante.
 * 3. Sincroniza la geometría 3D WKT (LINESTRINGZ) cuando finaliza el entrenamiento.
 */
export class EndomondoCloudSync {
  private supabase: SupabaseClient;
  private liveChannel: RealtimeChannel | null = null;

  constructor() {
    this.supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }

  /**
   * Suscribe el entrenamiento activo para recibir Peptalks en vivo de amigos.
   */
  subscribeToLivePeptalks(
    workoutId: string,
    onPeptalkReceived: (peptalk: PeptalkMessage) => void
  ): void {
    this.unsubscribeLiveChannel();

    this.liveChannel = this.supabase
      .channel(`workout-live:${workoutId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'peptalks',
          filter: `workout_id=eq.${workoutId}`,
        },
        (payload) => {
          const row = payload.new as {
            id: string;
            workout_id: string;
            author_name: string;
            message: string;
            created_at: string;
          };
          onPeptalkReceived({
            id: row.id,
            workoutId: row.workout_id,
            authorName: row.author_name,
            message: row.message,
            createdAt: new Date(row.created_at).getTime(),
            spokenByCoach: false,
          });
        }
      )
      .subscribe();
  }

  /**
   * Emite la posición actual y telemetría al canal Realtime (baja latencia)
   */
  async broadcastLiveTelemetry(
    workoutId: string,
    point: TrackPoint,
    state: LiveWorkoutState
  ): Promise<void> {
    if (!this.liveChannel) return;
    await this.liveChannel.send({
      type: 'broadcast',
      event: 'telemetry_tick',
      payload: {
        workoutId,
        lat: point.latitude,
        lon: point.longitude,
        alt: point.altitude,
        distanceMeters: Math.round(state.distanceMeters),
        paceSecPerKm: Math.round(state.currentPaceSecPerKm),
        heartRateBpm: state.currentHeartRateBpm,
        status: state.status,
      },
    });
  }

  /**
   * Convierte el array de puntos GPS en formato PostGIS EWKT 3D:
   * SRID=4326;LINESTRINGZ(lon lat alt, ...)
   */
  static buildPostGisLineStringZ(points: TrackPoint[]): string | null {
    if (points.length < 2) return null;
    const coords = points
      .map(
        (p) =>
          `${p.longitude.toFixed(6)} ${p.latitude.toFixed(6)} ${(
            p.altitude ?? 0
          ).toFixed(1)}`
      )
      .join(', ');
    return `SRID=4326;LINESTRINGZ(${coords})`;
  }

  unsubscribeLiveChannel(): void {
    if (this.liveChannel) {
      void this.supabase.removeChannel(this.liveChannel);
      this.liveChannel = null;
    }
  }
}
