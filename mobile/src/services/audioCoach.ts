import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import * as Speech from 'expo-speech';
import {
  AudioCoachSettings,
  LiveWorkoutState,
  PeptalkMessage,
  WorkoutLap,
} from '../types/workout';

/**
 * ENDOMONDO AUDIO COACH NEO
 * Reproduce avisos por voz cada kilómetro, alertas de ritmo objetivo (Ghost),
 * estado de Auto-Pausa y lectura en vivo de Peptalks de amigos, aplicando
 * Audio Ducking automático sobre Spotify / Apple Music.
 */
export class EndomondoAudioCoach {
  private settings: AudioCoachSettings;

  constructor(initialSettings?: Partial<AudioCoachSettings>) {
    this.settings = {
      enabled: true,
      language: 'es-ES',
      voiceRate: 1.03,
      announceEveryKm: true,
      announceLapPace: true,
      announceHeartRateZone: true,
      announceTargetGhostDelta: true,
      announceAutoPause: true,
      readLivePeptalks: true,
      targetPaceSecPerKm: 300, // 5:00 min/km por defecto
      ...initialSettings,
    };
  }

  updateSettings(partial: Partial<AudioCoachSettings>): void {
    this.settings = { ...this.settings, ...partial };
  }

  getSettings(): AudioCoachSettings {
    return this.settings;
  }

  /**
   * Configura Audio Ducking en iOS y Android para bajar suavemente el volumen
   * de la música en segundo plano mientras habla el entrenador.
   */
  private async enableAudioDucking(duck: boolean): Promise<void> {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        interruptionModeIOS: duck
          ? InterruptionModeIOS.DuckOthers
          : InterruptionModeIOS.MixWithOthers,
        shouldDuckAndroid: duck,
        interruptionModeAndroid: duck
          ? InterruptionModeAndroid.DuckOthers
          : InterruptionModeAndroid.DoNotMix,
      });
    } catch {
      // Fallback silencioso en simuladores sin sesión de audio activa
    }
  }

  async speak(text: string): Promise<void> {
    if (!this.settings.enabled) return;
    await this.enableAudioDucking(true);
    Speech.speak(text, {
      language: this.settings.language,
      rate: this.settings.voiceRate,
      pitch: 1.0,
      onDone: () => {
        void this.enableAudioDucking(false);
      },
      onError: () => {
        void this.enableAudioDucking(false);
      },
    });
  }

  static formatPaceForSpeechEs(paceSecPerKm: number): string {
    if (!Number.isFinite(paceSecPerKm) || paceSecPerKm <= 0) {
      return 'ritmo desconocido';
    }
    const mins = Math.floor(paceSecPerKm / 60);
    const secs = Math.round(paceSecPerKm % 60);
    if (secs === 0) return `${mins} minutos exactos`;
    return `${mins} minutos y ${secs} segundos`;
  }

  async announceWorkoutStarted(sportNameEs: string): Promise<void> {
    await this.speak(`Entrenamiento de ${sportNameEs} iniciado. ¡A por todas!`);
  }

  async announceAutoPauseState(isPaused: boolean): Promise<void> {
    if (!this.settings.announceAutoPause) return;
    if (isPaused) {
      await this.speak('Entrenamiento en auto pausa.');
    } else {
      await this.speak('En movimiento. Entrenamiento reanudado.');
    }
  }

  /**
   * Anuncio clásico de Endomondo al completar cada vuelta de 1 km:
   * "Distancia: 3 kilómetros. Último kilómetro en 4 minutos y 48 segundos.
   *  Frecuencia cardíaca: 158 pulsaciones. Vas 12 segundos por delante de tu objetivo."
   */
  async announceLapSplit(lap: WorkoutLap, state: LiveWorkoutState): Promise<void> {
    if (!this.settings.enabled || !this.settings.announceEveryKm) return;

    const totalKm = Math.floor(state.distanceMeters / 1000);
    const segments: string[] = [
      `Distancia: ${totalKm} ${totalKm === 1 ? 'kilómetro' : 'kilómetros'}.`,
    ];

    if (this.settings.announceLapPace) {
      const lapSpeech = EndomondoAudioCoach.formatPaceForSpeechEs(lap.paceSecPerKm);
      segments.push(`Último kilómetro en ${lapSpeech}.`);
    }

    if (this.settings.announceHeartRateZone && lap.avgHeartRateBpm) {
      segments.push(`Frecuencia cardíaca: ${lap.avgHeartRateBpm} pulsaciones.`);
    }

    if (
      this.settings.announceTargetGhostDelta &&
      this.settings.targetPaceSecPerKm
    ) {
      const targetTotalSec = totalKm * this.settings.targetPaceSecPerKm;
      const deltaSec = Math.round(targetTotalSec - state.activeDurationSec);
      if (Math.abs(deltaSec) >= 3) {
        if (deltaSec > 0) {
          segments.push(`Vas ${deltaSec} segundos por delante de tu objetivo.`);
        } else {
          segments.push(
            `Vas ${Math.abs(deltaSec)} segundos por detrás de tu objetivo.`
          );
        }
      } else {
        segments.push('Clavado en tu ritmo objetivo.');
      }
    }

    await this.speak(segments.join(' '));
  }

  /**
   * Lee en vivo un Peptalk enviado por un amigo desde la web o app.
   */
  async announceIncomingPeptalk(peptalk: PeptalkMessage): Promise<void> {
    if (!this.settings.enabled || !this.settings.readLivePeptalks) return;
    await this.speak(
      `Peptalk de ${peptalk.authorName}: ¡${peptalk.message}!`
    );
  }
}
