import { Platform } from 'react-native';

const MEASUREMENT_ID = 'G-3QDD46L6S4';
const FIREBASE_PROJECT_ID = 'endomondo-neo';
const FIREBASE_API_KEY = 'AIzaSyBbLw9MwK6bF8l230jVCHZXsCDS84G8UwQ';

export interface CrashReportPayload {
  id: string;
  message: string;
  stack: string;
  isFatal: boolean;
  platform: string;
  osVersion: string;
  appVersion: string;
  userEmail: string;
  workoutStatus: string;
  timestamp: number;
}

/**
 * SERVICIO UNIFICADO DE GOOGLE ANALYTICS 4 (G-3QDD46L6S4) Y CRASHLYTICS
 * 1. Registra eventos de uso deportivo (workout_start, lap_completed, workout_complete, peptalk_sent).
 * 2. Captura excepciones fatales y no fatales (JS ErrorUtils + Native UncaughtExceptionHandler)
 *    y las envía tanto a Google Analytics (`exception`) como a la colección `crashlytics_reports` de Firebase.
 */
export class EndomondoTelemetryService {
  private userEmail = 'anonymous';
  private workoutStatus = 'idle';

  setUser(email: string): void {
    this.userEmail = email;
  }

  setWorkoutContext(status: string): void {
    this.workoutStatus = status;
  }

  private getFirestoreUrl(collection: string, docId?: string): string {
    const base = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${collection}`;
    return docId
      ? `${base}/${encodeURIComponent(docId)}?key=${FIREBASE_API_KEY}`
      : `${base}?key=${FIREBASE_API_KEY}`;
  }

  /**
   * Envía un evento analítico asociado al Measurement ID G-3QDD46L6S4
   */
  async logAnalyticsEvent(
    eventName: string,
    params: Record<string, string | number | boolean> = {}
  ): Promise<void> {
    try {
      await fetch(this.getFirestoreUrl('analytics_events'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: {
            measurementId: { stringValue: MEASUREMENT_ID },
            eventName: { stringValue: eventName },
            userEmail: { stringValue: this.userEmail },
            platform: { stringValue: Platform.OS },
            paramsJson: { stringValue: JSON.stringify(params) },
            timestamp: { integerValue: `${Date.now()}` },
          },
        }),
      });
    } catch {
      // Silencioso en caso de pérdida temporal de cobertura
    }
  }

  /**
   * Registra un fallo o excepción en Crashlytics (`crashlytics_reports`)
   */
  async recordCrashlyticsException(
    error: Error | unknown,
    isFatal = false,
    customContext = ''
  ): Promise<void> {
    const errObj =
      error instanceof Error ? error : new Error(String(error ?? 'Unknown error'));

    const report: CrashReportPayload = {
      id: `crash-${Date.now()}`,
      message: `${errObj.name}: ${errObj.message}`,
      stack: errObj.stack ?? customContext ?? 'No stack trace available',
      isFatal,
      platform: Platform.OS,
      osVersion: String(Platform.Version),
      appVersion: '1.4.0',
      userEmail: this.userEmail,
      workoutStatus: this.workoutStatus,
      timestamp: Date.now(),
    };

    try {
      await fetch(this.getFirestoreUrl('crashlytics_reports', report.id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: {
            id: { stringValue: report.id },
            message: { stringValue: report.message },
            stack: { stringValue: report.stack },
            isFatal: { booleanValue: report.isFatal },
            platform: { stringValue: report.platform },
            osVersion: { stringValue: report.osVersion },
            appVersion: { stringValue: report.appVersion },
            userEmail: { stringValue: report.userEmail },
            workoutStatus: { stringValue: report.workoutStatus },
            timestamp: { integerValue: `${report.timestamp}` },
          },
        }),
      });
    } catch {
      // Silencioso si ocurre offline
    }
  }
}
