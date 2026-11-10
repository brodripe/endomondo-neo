import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import * as Location from 'expo-location';
import React, { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { ENDOMONDO_SPORTS, METRIC_LABELS_ES } from '../constants/sports';
import { LocalWorkoutDatabase } from '../db/localDatabase';
import {
  setAndroidBackgroundLocationListener,
  startAndroidForegroundGpsService,
  stopAndroidForegroundGpsService,
} from '../services/androidBackgroundLocationTask';
import { EndomondoAudioCoach } from '../services/audioCoach';
import { AndroidBleHeartRateService } from '../services/bleHeartRateAndroid';
import { EndomondoGpsEngine } from '../services/gpsEngine';
import { EndomondoCloudSync } from '../services/supabaseSync';
import {
  LiveWorkoutState,
  MetricTileKey,
  SportId,
} from '../types/workout';

const ALL_METRIC_KEYS: MetricTileKey[] = [
  'duration',
  'distance',
  'pace_current',
  'pace_avg',
  'pace_lap',
  'speed_kmh',
  'heart_rate',
  'calories',
  'elevation_gain',
  'hydration_ml',
];

function formatDuration(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatPace(secPerKm: number): string {
  if (!Number.isFinite(secPerKm) || secPerKm <= 0 || secPerKm > 3600) {
    return '--:--';
  }
  const mins = Math.floor(secPerKm / 60);
  const secs = Math.round(secPerKm % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export const WorkoutTrackerScreen: React.FC = () => {
  // Mantiene la pantalla activa en Android mientras el cockpit está visible
  useKeepAwake();

  const [selectedSport, setSelectedSport] = useState<SportId>('running');
  const [sportModalVisible, setSportModalVisible] = useState(false);
  const [activeTab, setActiveTab] = useState<'tracker' | 'laps'>('tracker');
  const [gridMetrics, setGridMetrics] = useState<
    [MetricTileKey, MetricTileKey, MetricTileKey, MetricTileKey]
  >(ENDOMONDO_SPORTS.running.defaultGridMetrics);
  const [audioCoachEnabled, setAudioCoachEnabled] = useState(true);
  const [autoPauseEnabled, setAutoPauseEnabled] = useState(true);
  const [screenLocked, setScreenLocked] = useState(false);
  const [bleStatusText, setBleStatusText] = useState<string>('BLE FC Disponible');

  const [workout, setWorkout] = useState<LiveWorkoutState>(() => ({
    workoutId: `endo-${Date.now()}`,
    sportId: 'running',
    status: 'idle',
    startedAt: null,
    activeDurationSec: 0,
    totalElapsedSec: 0,
    distanceMeters: 0,
    currentSpeedMs: 0,
    currentPaceSecPerKm: 0,
    avgPaceSecPerKm: 0,
    currentLapPaceSecPerKm: 0,
    elevationGainMeters: 0,
    elevationLossMeters: 0,
    currentAltitudeMeters: null,
    caloriesKcal: 0,
    hydrationNeedsMl: 0,
    currentHeartRateBpm: 140,
    avgHeartRateBpm: 140,
    maxHeartRateBpm: 140,
    currentCadenceSpm: 168,
    points: [],
    laps: [],
    peptalks: [],
    personalRecordsBroken: [],
  }));

  const localDbRef = useRef(new LocalWorkoutDatabase());
  const cloudSyncRef = useRef(new EndomondoCloudSync());
  const audioCoachRef = useRef(new EndomondoAudioCoach());
  const bleHrServiceRef = useRef(new AndroidBleHeartRateService());
  const gpsEngineRef = useRef<EndomondoGpsEngine | null>(null);
  const locationSubRef = useRef<Location.LocationSubscription | null>(null);

  const ingestLocationObject = (loc: Location.LocationObject) => {
    setWorkout((prev) => {
      if (!gpsEngineRef.current) return prev;
      const next = gpsEngineRef.current.ingestSample(prev, {
        timestamp: loc.timestamp,
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        altitude: loc.coords.altitude,
        accuracyMeters: loc.coords.accuracy ?? 5,
        nativeSpeedMs: loc.coords.speed,
        heartRateBpm: prev.currentHeartRateBpm,
        cadenceSpm: prev.currentCadenceSpm,
        powerWatts: null,
      });
      const latestPoint = next.points[next.points.length - 1];
      if (latestPoint) {
        void localDbRef.current.insertTrackPoint(next.workoutId, latestPoint);
        void localDbRef.current.upsertWorkoutSnapshot(next);
        void cloudSyncRef.current.broadcastLiveTelemetry(
          next.workoutId,
          latestPoint,
          next
        );
      }
      return next;
    });
  };

  useEffect(() => {
    void localDbRef.current.init();
    gpsEngineRef.current = new EndomondoGpsEngine(
      {
        onLapCompleted: (lap, nextState) => {
          void Haptics.notificationAsync(
            Haptics.NotificationFeedbackType.Success
          );
          void localDbRef.current.insertLap(nextState.workoutId, lap);
          void audioCoachRef.current.announceLapSplit(lap, nextState);
        },
        onAutoPauseChanged: (isAutoPaused) => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          void audioCoachRef.current.announceAutoPauseState(isAutoPaused);
        },
      },
      autoPauseEnabled
    );

    // Conectar el listener del Foreground Service de Android para pantalla apagada
    setAndroidBackgroundLocationListener((locations) => {
      locations.forEach((loc) => ingestLocationObject(loc));
    });

    return () => {
      locationSubRef.current?.remove();
      setAndroidBackgroundLocationListener(null);
      void stopAndroidForegroundGpsService();
      void bleHrServiceRef.current.disconnect();
      cloudSyncRef.current.unsubscribeLiveChannel();
    };
  }, []);

  const handleSelectSport = (sportId: SportId) => {
    if (workout.status !== 'idle' && workout.status !== 'completed') return;
    setSelectedSport(sportId);
    setGridMetrics(ENDOMONDO_SPORTS[sportId].defaultGridMetrics);
    setWorkout((prev) => ({ ...prev, sportId }));
    setSportModalVisible(false);
  };

  const handleConnectBleStrap = async () => {
    await bleHrServiceRef.current.scanAndConnectHeartRateStrap(
      (bpm, devName) => {
        setBleStatusText(`💙 ${devName}: ${bpm} ppm`);
        setWorkout((prev) => ({ ...prev, currentHeartRateBpm: bpm }));
      },
      (status) => setBleStatusText(status)
    );
  };

  const cycleMetricTile = (tileIndex: 0 | 1 | 2 | 3) => {
    if (screenLocked) return;
    setGridMetrics((prev) => {
      const currentKey = prev[tileIndex];
      const nextIdx =
        (ALL_METRIC_KEYS.indexOf(currentKey) + 1) % ALL_METRIC_KEYS.length;
      const updated = [...prev] as [
        MetricTileKey,
        MetricTileKey,
        MetricTileKey,
        MetricTileKey,
      ];
      updated[tileIndex] = ALL_METRIC_KEYS[nextIdx];
      return updated;
    });
  };

  const renderMetricValue = (key: MetricTileKey): string => {
    switch (key) {
      case 'duration':
        return formatDuration(workout.activeDurationSec);
      case 'distance':
        return (workout.distanceMeters / 1000).toFixed(2);
      case 'pace_current':
        return formatPace(workout.currentPaceSecPerKm);
      case 'pace_avg':
        return formatPace(workout.avgPaceSecPerKm);
      case 'pace_lap':
        return formatPace(workout.currentLapPaceSecPerKm);
      case 'speed_kmh':
        return (workout.currentSpeedMs * 3.6).toFixed(1);
      case 'heart_rate':
        return workout.currentHeartRateBpm
          ? `${workout.currentHeartRateBpm}`
          : '--';
      case 'calories':
        return `${workout.caloriesKcal}`;
      case 'elevation_gain':
        return `+${Math.round(workout.elevationGainMeters)}`;
      case 'hydration_ml':
        return `${workout.hydrationNeedsMl}`;
      default:
        return '--';
    }
  };

  const startWorkout = async () => {
    const sportNameEs = ENDOMONDO_SPORTS[selectedSport].nameEs;

    // Iniciar Foreground Service de Android (notificación persistente + GPS con pantalla apagada)
    await startAndroidForegroundGpsService(sportNameEs);

    const newWorkoutId = `endo-${Date.now()}`;
    gpsEngineRef.current?.resetFilters();
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    setWorkout((prev) => ({
      ...prev,
      workoutId: newWorkoutId,
      status: 'active',
      startedAt: Date.now(),
      activeDurationSec: 0,
      distanceMeters: 0,
      points: [],
      laps: [],
    }));

    void audioCoachRef.current.announceWorkoutStarted(sportNameEs);

    // Suscribirse a Peptalks en vivo de amigos
    cloudSyncRef.current.subscribeToLivePeptalks(newWorkoutId, (peptalk) => {
      setWorkout((prev) => ({
        ...prev,
        peptalks: [peptalk, ...prev.peptalks],
      }));
      void audioCoachRef.current.announceIncomingPeptalk(peptalk);
    });

    // GPS de Doble Frecuencia L1+L5 (BestForNavigation) en primer plano
    locationSubRef.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 1000,
        distanceInterval: 1,
      },
      (loc) => ingestLocationObject(loc)
    );
  };

  const togglePauseWorkout = () => {
    if (screenLocked) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setWorkout((prev) => ({
      ...prev,
      status: prev.status === 'manual_paused' ? 'active' : 'manual_paused',
    }));
  };

  const stopWorkout = async () => {
    if (screenLocked) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    locationSubRef.current?.remove();
    await stopAndroidForegroundGpsService();
    cloudSyncRef.current.unsubscribeLiveChannel();

    setWorkout((prev) => {
      const completed = { ...prev, status: 'completed' as const };
      void localDbRef.current.upsertWorkoutSnapshot(completed);
      void localDbRef.current.enqueueForCloudSync(
        'workout_completed',
        completed.workoutId,
        completed
      );
      return completed;
    });
  };

  const sportDef = ENDOMONDO_SPORTS[selectedSport];

  return (
    <SafeAreaView style={styles.container}>
      {/* Cabecera estilo Endomondo con Selector de Deporte y Audio Coach */}
      <View style={styles.header}>
        <Pressable
          style={styles.sportPill}
          onPress={() => {
            if (workout.status === 'idle' || workout.status === 'completed') {
              setSportModalVisible(true);
            }
          }}
        >
          <Text style={styles.sportIcon}>{sportDef.icon}</Text>
          <Text style={styles.sportTitle}>{sportDef.nameEs} ▾</Text>
        </Pressable>
        <View style={styles.headerActions}>
          <Pressable
            style={[
              styles.badgeBtn,
              audioCoachEnabled && styles.badgeBtnActive,
            ]}
            onPress={() => {
              const next = !audioCoachEnabled;
              setAudioCoachEnabled(next);
              audioCoachRef.current.updateSettings({ enabled: next });
            }}
          >
            <Text style={styles.badgeText}>
              🔊 {audioCoachEnabled ? 'ON' : 'OFF'}
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.badgeBtn,
              autoPauseEnabled && styles.badgeBtnActive,
            ]}
            onPress={() => {
              const next = !autoPauseEnabled;
              setAutoPauseEnabled(next);
              gpsEngineRef.current?.setAutoPauseEnabled(next);
            }}
          >
            <Text style={styles.badgeText}>
              ⏸️ Auto {autoPauseEnabled ? 'ON' : 'OFF'}
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Barra Bluetooth LE Android + Bloqueo de pantalla contra lluvia/sudor */}
      <View style={styles.subHeaderBar}>
        <Pressable onPress={handleConnectBleStrap} style={styles.bleButton}>
          <Text style={styles.bleText}>{bleStatusText}</Text>
        </Pressable>
        <Pressable
          onPress={() => setScreenLocked((prev) => !prev)}
          style={[
            styles.lockButton,
            screenLocked && styles.lockButtonActive,
          ]}
        >
          <Text style={styles.lockText}>
            {screenLocked ? '🔒 Bloqueado (Toca para desbloquear)' : '🔓 Bloquear Táctil'}
          </Text>
        </Pressable>
      </View>

      {/* Banner de Auto-Pausa */}
      {workout.status === 'auto_paused' && (
        <View style={styles.autoPauseBanner}>
          <Text style={styles.autoPauseText}>
            ⚡ AUTO-PAUSA ACTIVA — Muévete para reanudar automáticamente
          </Text>
        </View>
      )}

      {/* Pestañas: Tracker vs Parciales (Laps) */}
      <View style={styles.tabBar}>
        <Pressable
          style={[styles.tab, activeTab === 'tracker' && styles.tabActive]}
          onPress={() => setActiveTab('tracker')}
        >
          <Text style={styles.tabLabel}>PANEL & MAPA EN VIVO</Text>
        </Pressable>
        <Pressable
          style={[styles.tab, activeTab === 'laps' && styles.tabActive]}
          onPress={() => setActiveTab('laps')}
        >
          <Text style={styles.tabLabel}>
            VUELTAS / SPLITS ({workout.laps.length})
          </Text>
        </Pressable>
      </View>

      {activeTab === 'tracker' ? (
        <>
          {/* Cuadrícula Icónica de 4 Métricas de Endomondo (Pulsa para cambiar métrica) */}
          <View style={styles.metricsGrid}>
            {gridMetrics.map((metricKey, idx) => {
              const meta = METRIC_LABELS_ES[metricKey];
              return (
                <Pressable
                  key={`${metricKey}-${idx}`}
                  style={styles.metricTile}
                  onPress={() => cycleMetricTile(idx as 0 | 1 | 2 | 3)}
                >
                  <Text style={styles.metricLabel}>{meta.label}</Text>
                  <Text style={styles.metricValue}>
                    {renderMetricValue(metricKey)}
                  </Text>
                  <Text style={styles.metricUnit}>{meta.unit}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* Mapa GPS con polilínea del recorrido */}
          <View style={styles.mapContainer}>
            <MapView
              style={StyleSheet.absoluteFillObject}
              showsUserLocation
              followsUserLocation
            >
              {workout.points.length > 1 && (
                <Polyline
                  coordinates={workout.points.map((p) => ({
                    latitude: p.latitude,
                    longitude: p.longitude,
                  }))}
                  strokeColor="#87C80A"
                  strokeWidth={5}
                />
              )}
              {workout.points.length > 0 && (
                <Marker
                  coordinate={{
                    latitude: workout.points[0].latitude,
                    longitude: workout.points[0].longitude,
                  }}
                  title="Salida"
                />
              )}
            </MapView>
          </View>
        </>
      ) : (
        <FlatList
          data={workout.laps}
          keyExtractor={(item) => `${item.lapNumber}`}
          style={styles.lapsList}
          ListEmptyComponent={
            <Text style={styles.emptyLaps}>
              Completa tu primer kilómetro para ver el desglose de vueltas y
              ritmo parcial.
            </Text>
          }
          renderItem={({ item }) => (
            <View style={styles.lapRow}>
              <Text style={styles.lapNum}>KM {item.lapNumber}</Text>
              <Text style={styles.lapPace}>
                {formatPace(item.paceSecPerKm)} /km
              </Text>
              <Text style={styles.lapElev}>
                {item.elevationDeltaMeters >= 0
                  ? `+${item.elevationDeltaMeters}m`
                  : `${item.elevationDeltaMeters}m`}
              </Text>
              <Text style={styles.lapHr}>
                ❤️ {item.avgHeartRateBpm ?? '--'} ppm
              </Text>
            </View>
          )}
        />
      )}

      {/* Controles principales de entrenamiento */}
      <View style={styles.controlsRow}>
        {workout.status === 'idle' || workout.status === 'completed' ? (
          <Pressable style={styles.startButton} onPress={startWorkout}>
            <Text style={styles.startButtonText}>▶ INICIAR ENTRENAMIENTO</Text>
          </Pressable>
        ) : (
          <View style={styles.activeControls}>
            <Pressable
              style={[styles.pauseButton, screenLocked && styles.disabledBtn]}
              onPress={togglePauseWorkout}
            >
              <Text style={styles.controlText}>
                {workout.status === 'manual_paused' ? '▶ REANUDAR' : '⏸ PAUSAR'}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.stopButton, screenLocked && styles.disabledBtn]}
              onPress={stopWorkout}
            >
              <Text style={styles.controlText}>⏹ FINALIZAR</Text>
            </Pressable>
          </View>
        )}
      </View>

      {/* Modal Selector de Deportes Clásicos de Endomondo */}
      <Modal
        visible={sportModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setSportModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Selecciona un Deporte</Text>
            <FlatList
              data={Object.values(ENDOMONDO_SPORTS)}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <Pressable
                  style={[
                    styles.sportOptionRow,
                    selectedSport === item.id && styles.sportOptionSelected,
                  ]}
                  onPress={() => handleSelectSport(item.id)}
                >
                  <Text style={styles.sportOptionIcon}>{item.icon}</Text>
                  <Text style={styles.sportOptionName}>{item.nameEs}</Text>
                </Pressable>
              )}
            />
            <Pressable
              style={styles.closeModalBtn}
              onPress={() => setSportModalVisible(false)}
            >
              <Text style={styles.closeModalText}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#101418',
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#1F2933',
  },
  sportPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1B242D',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  sportIcon: {
    fontSize: 20,
    marginRight: 8,
  },
  sportTitle: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  badgeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: '#1F2933',
  },
  badgeBtnActive: {
    backgroundColor: '#87C80A',
  },
  badgeText: {
    color: '#0B0F12',
    fontWeight: '700',
    fontSize: 11,
  },
  subHeaderBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: '#141B22',
    borderBottomWidth: 1,
    borderBottomColor: '#1F2933',
  },
  bleButton: {
    paddingVertical: 4,
  },
  bleText: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '700',
  },
  lockButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: '#1F2933',
  },
  lockButtonActive: {
    backgroundColor: '#F59E0B',
  },
  lockText: {
    color: '#E5E7EB',
    fontSize: 11,
    fontWeight: '700',
  },
  autoPauseBanner: {
    backgroundColor: '#F59E0B',
    paddingVertical: 8,
    alignItems: 'center',
  },
  autoPauseText: {
    color: '#111827',
    fontWeight: '800',
    fontSize: 12,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#161C22',
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: '#87C80A',
  },
  tabLabel: {
    color: '#E5E7EB',
    fontSize: 12,
    fontWeight: '700',
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: '#1F2933',
    gap: 1,
  },
  metricTile: {
    width: '49.8%',
    backgroundColor: '#141A20',
    paddingVertical: 14,
    alignItems: 'center',
  },
  metricLabel: {
    color: '#9CA3AF',
    fontSize: 11,
    fontWeight: '700',
  },
  metricValue: {
    color: '#FFFFFF',
    fontSize: 34,
    fontWeight: '800',
    marginVertical: 2,
  },
  metricUnit: {
    color: '#87C80A',
    fontSize: 12,
    fontWeight: '600',
  },
  mapContainer: {
    flex: 1,
    minHeight: 220,
  },
  lapsList: {
    flex: 1,
    padding: 16,
  },
  emptyLaps: {
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: 40,
  },
  lapRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1F2933',
  },
  lapNum: {
    color: '#87C80A',
    fontWeight: '800',
  },
  lapPace: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  lapElev: {
    color: '#9CA3AF',
  },
  lapHr: {
    color: '#F87171',
    fontWeight: '600',
  },
  controlsRow: {
    padding: 16,
    backgroundColor: '#101418',
  },
  startButton: {
    backgroundColor: '#87C80A',
    paddingVertical: 16,
    borderRadius: 30,
    alignItems: 'center',
  },
  startButtonText: {
    color: '#0B0F12',
    fontSize: 16,
    fontWeight: '900',
  },
  activeControls: {
    flexDirection: 'row',
    gap: 12,
  },
  pauseButton: {
    flex: 1,
    backgroundColor: '#F59E0B',
    paddingVertical: 16,
    borderRadius: 30,
    alignItems: 'center',
  },
  stopButton: {
    flex: 1,
    backgroundColor: '#EF4444',
    paddingVertical: 16,
    borderRadius: 30,
    alignItems: 'center',
  },
  disabledBtn: {
    opacity: 0.4,
  },
  controlText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 15,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#161C22',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '75%',
  },
  modalTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 12,
  },
  sportOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 4,
  },
  sportOptionSelected: {
    backgroundColor: 'rgba(135, 200, 10, 0.2)',
  },
  sportOptionIcon: {
    fontSize: 22,
    marginRight: 12,
  },
  sportOptionName: {
    color: '#F3F4F6',
    fontSize: 15,
    fontWeight: '600',
  },
  closeModalBtn: {
    marginTop: 12,
    backgroundColor: '#263240',
    paddingVertical: 12,
    borderRadius: 24,
    alignItems: 'center',
  },
  closeModalText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
});
