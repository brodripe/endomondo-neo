import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

export const ANDROID_BG_LOCATION_TASK = 'ENDOMONDO_NEO_ANDROID_BG_LOCATION';

type BackgroundLocationListener = (locations: Location.LocationObject[]) => void;

let activeListener: BackgroundLocationListener | null = null;

/**
 * Registra el callback que recibirá los puntos GPS desde el Foreground Service de Android
 * incluso cuando el móvil tiene la pantalla apagada o bloqueada en el bolsillo.
 */
export function setAndroidBackgroundLocationListener(
  listener: BackgroundLocationListener | null
): void {
  activeListener = listener;
}

// Definición global de la tarea en segundo plano para Android / iOS
if (!TaskManager.isTaskDefined(ANDROID_BG_LOCATION_TASK)) {
  TaskManager.defineTask(ANDROID_BG_LOCATION_TASK, async ({ data, error }) => {
    if (error) {
      console.warn('[EndomondoNeo BG Location Error]:', error.message);
      return;
    }
    if (data) {
      const { locations } = data as { locations: Location.LocationObject[] };
      if (locations && locations.length > 0 && activeListener) {
        activeListener(locations);
      }
    }
  });
}

/**
 * Solicita permisos de ubicación en primer y segundo plano en Android 10+ (API 29-35)
 * e inicia el Foreground Service con notificación persistente estilo Endomondo.
 */
export async function startAndroidForegroundGpsService(
  sportNameEs: string
): Promise<boolean> {
  const fgPerm = await Location.requestForegroundPermissionsAsync();
  if (fgPerm.status !== 'granted') {
    return false;
  }

  // En Android 10+ se solicita permiso "Permitir todo el tiempo" para no perder señal con pantalla apagada
  const bgPerm = await Location.requestBackgroundPermissionsAsync();

  if (bgPerm.status === 'granted') {
    const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(
      ANDROID_BG_LOCATION_TASK
    );
    if (!alreadyStarted) {
      await Location.startLocationUpdatesAsync(ANDROID_BG_LOCATION_TASK, {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 1000,
        distanceInterval: 1,
        showsBackgroundLocationIndicator: true,
        pausesUpdatesAutomatically: false,
        foregroundService: {
          notificationTitle: `🟢 Endomondo Neo — ${sportNameEs}`,
          notificationBody:
            'GPS de alta precisión y Audio Coach activos en segundo plano',
          notificationColor: '#87C80A',
        },
      });
    }
    return true;
  }

  return false;
}

/**
 * Detiene el Foreground Service de Android al finalizar el entrenamiento.
 */
export async function stopAndroidForegroundGpsService(): Promise<void> {
  try {
    const started = await Location.hasStartedLocationUpdatesAsync(
      ANDROID_BG_LOCATION_TASK
    );
    if (started) {
      await Location.stopLocationUpdatesAsync(ANDROID_BG_LOCATION_TASK);
    }
  } catch {
    // Ignorar si la tarea ya estaba detenida
  }
}
