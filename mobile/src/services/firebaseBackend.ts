import { LiveWorkoutState, PeptalkMessage, TrackPoint } from '../types/workout';
import { GoogleUserProfile } from './googleAuth';

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId: string;
}

/**
 * CLIENTE BACKEND FIREBASE (CLOUD FIRESTORE + GOOGLE AUTH) PARA ENDOMONDO NEO
 * Sincroniza perfiles de usuario, entrenamientos completos (con ruta GPS y parciales/laps)
 * y escucha Peptalks en vivo sobre la colección `workouts/{workoutId}/peptalks`.
 */
export class EndomondoFirebaseBackend {
  private config: FirebaseConfig;
  private pollIntervalId: ReturnType<typeof setInterval> | null = null;
  private seenPeptalkIds = new Set<string>();

  constructor(config?: Partial<FirebaseConfig>) {
    this.config = {
      apiKey:
        process.env.EXPO_PUBLIC_FIREBASE_API_KEY ??
        'AIzaSyBbLw9MwK6bF8l230jVCHZXsCDS84G8UwQ',
      authDomain:
        process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ??
        'endomondo-neo.firebaseapp.com',
      projectId:
        process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? 'endomondo-neo',
      storageBucket:
        process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ??
        'endomondo-neo.firebasestorage.app',
      messagingSenderId:
        process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '177593536458',
      appId:
        process.env.EXPO_PUBLIC_FIREBASE_APP_ID ??
        '1:177593536458:web:4a739724fa93bee6128933',
      ...config,
    };
  }

  isConfigured(): boolean {
    return Boolean(this.config.projectId && this.config.apiKey);
  }

  updateConfig(newConfig: FirebaseConfig): void {
    this.config = newConfig;
  }

  private getFirestoreBaseUrl(): string {
    return `https://firestore.googleapis.com/v1/projects/${this.config.projectId}/databases/(default)/documents`;
  }

  /**
   * Guarda o actualiza el perfil del usuario autenticado con Google en `users/{email}`
   */
  async upsertUserProfile(user: GoogleUserProfile): Promise<boolean> {
    if (!this.isConfigured()) return false;
    const docId = encodeURIComponent(user.email);
    const url = `${this.getFirestoreBaseUrl()}/users/${docId}?key=${this.config.apiKey}`;

    const body = {
      fields: {
        email: { stringValue: user.email },
        displayName: { stringValue: user.displayName },
        avatarUrl: { stringValue: user.avatarUrl ?? '' },
        provider: { stringValue: 'google' },
        updatedAt: { integerValue: `${Date.now()}` },
      },
    };

    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.ok;
  }

  /**
   * Guarda un entrenamiento en vivo o finalizado en Cloud Firestore (`workouts/{workoutId}`)
   */
  async syncWorkoutToFirestore(
    state: LiveWorkoutState,
    userEmail: string
  ): Promise<boolean> {
    if (!this.isConfigured()) return false;
    const url = `${this.getFirestoreBaseUrl()}/workouts/${encodeURIComponent(
      state.workoutId
    )}?key=${this.config.apiKey}`;

    // Muestrear hasta 250 puntos representativos para el documento principal
    const sampledPoints = EndomondoFirebaseBackend.downsampleTrack(state.points, 250);

    const body = {
      fields: {
        workoutId: { stringValue: state.workoutId },
        userEmail: { stringValue: userEmail },
        sportId: { stringValue: state.sportId },
        status: { stringValue: state.status },
        startedAt: { integerValue: `${state.startedAt ?? Date.now()}` },
        activeDurationSec: { doubleValue: state.activeDurationSec },
        distanceMeters: { doubleValue: state.distanceMeters },
        avgPaceSecPerKm: { doubleValue: state.avgPaceSecPerKm },
        elevationGainMeters: { doubleValue: state.elevationGainMeters },
        caloriesKcal: { integerValue: `${state.caloriesKcal}` },
        hydrationNeedsMl: { integerValue: `${state.hydrationNeedsMl}` },
        avgHeartRateBpm: { integerValue: `${state.avgHeartRateBpm ?? 0}` },
        lapsJson: { stringValue: JSON.stringify(state.laps) },
        routeJson: { stringValue: JSON.stringify(sampledPoints) },
        updatedAt: { integerValue: `${Date.now()}` },
      },
    };

    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.ok;
  }

  /**
   * Envía un Peptalk en vivo a `workouts/{workoutId}/peptalks` en Firestore
   */
  async sendLivePeptalk(
    workoutId: string,
    authorName: string,
    message: string
  ): Promise<boolean> {
    if (!this.isConfigured()) return false;
    const url = `${this.getFirestoreBaseUrl()}/workouts/${encodeURIComponent(
      workoutId
    )}/peptalks?key=${this.config.apiKey}`;

    const body = {
      fields: {
        workoutId: { stringValue: workoutId },
        authorName: { stringValue: authorName },
        message: { stringValue: message },
        createdAt: { integerValue: `${Date.now()}` },
      },
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.ok;
  }

  /**
   * Escucha nuevos Peptalks en vivo desde Cloud Firestore para que el Audio Coach los lea
   */
  subscribeToFirestorePeptalks(
    workoutId: string,
    onPeptalk: (peptalk: PeptalkMessage) => void
  ): void {
    this.unsubscribePeptalks();
    if (!this.isConfigured()) return;

    this.pollIntervalId = setInterval(async () => {
      try {
        const url = `${this.getFirestoreBaseUrl()}/workouts/${encodeURIComponent(
          workoutId
        )}/peptalks?key=${this.config.apiKey}`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = (await res.json()) as {
          documents?: Array<{
            name: string;
            fields?: {
              authorName?: { stringValue?: string };
              message?: { stringValue?: string };
              createdAt?: { integerValue?: string };
            };
          }>;
        };
        if (!data.documents) return;
        for (const doc of data.documents) {
          const docId = doc.name.split('/').pop() ?? doc.name;
          if (!this.seenPeptalkIds.has(docId)) {
            this.seenPeptalkIds.add(docId);
            onPeptalk({
              id: docId,
              workoutId,
              authorName: doc.fields?.authorName?.stringValue ?? 'Amigo',
              message: doc.fields?.message?.stringValue ?? '',
              createdAt: Number(doc.fields?.createdAt?.integerValue ?? Date.now()),
              spokenByCoach: false,
            });
          }
        }
      } catch {
        // Ignorar fallos puntuales de red móvil en carrera
      }
    }, 3500);
  }

  unsubscribePeptalks(): void {
    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }
  }

  static downsampleTrack(
    points: TrackPoint[],
    maxPoints: number
  ): Array<{ lat: number; lon: number; alt: number | null; ts: number }> {
    if (points.length <= maxPoints) {
      return points.map((p) => ({
        lat: Number(p.latitude.toFixed(6)),
        lon: Number(p.longitude.toFixed(6)),
        alt: p.altitude,
        ts: p.timestamp,
      }));
    }
    const step = points.length / maxPoints;
    const result: Array<{ lat: number; lon: number; alt: number | null; ts: number }> = [];
    for (let i = 0; i < maxPoints; i++) {
      const p = points[Math.floor(i * step)];
      result.push({
        lat: Number(p.latitude.toFixed(6)),
        lon: Number(p.longitude.toFixed(6)),
        alt: p.altitude,
        ts: p.timestamp,
      });
    }
    return result;
  }
}
