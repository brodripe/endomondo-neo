import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, Device } from 'react-native-ble-plx';

const HEART_RATE_SERVICE_UUID = '0000180d-0000-1000-8000-00805f9b34fb';
const HEART_RATE_MEASUREMENT_CHAR_UUID = '00002a37-0000-1000-8000-00805f9b34fb';

/**
 * SERVICIO BLUETOOTH LOW ENERGY (BLE) PARA ANDROID (Polar, Garmin, Wahoo, Coospo, Decathlon)
 * Gestiona los permisos de Android 12+ (BLUETOOTH_SCAN, BLUETOOTH_CONNECT) y decodifica
 * los paquetes GATT 0x2A37 de frecuencia cardíaca en tiempo real.
 */
export class AndroidBleHeartRateService {
  private manager: BleManager | null = null;
  private connectedDevice: Device | null = null;

  constructor() {
    try {
      this.manager = new BleManager();
    } catch {
      // En entorno web o Expo Go sin módulo nativo BLE, se usa fallback
      this.manager = null;
    }
  }

  async requestAndroidBlePermissions(): Promise<boolean> {
    if (Platform.OS !== 'android') return true;

    if (Platform.Version >= 31) {
      const result = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);
      return (
        result['android.permission.BLUETOOTH_CONNECT'] ===
          PermissionsAndroid.RESULTS.GRANTED &&
        result['android.permission.BLUETOOTH_SCAN'] ===
          PermissionsAndroid.RESULTS.GRANTED
      );
    } else {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    }
  }

  /**
   * Decodifica el valor Base64 de la característica GATT 0x2A37 (Heart Rate Measurement)
   */
  private static decodeHeartRateBase64(base64Value: string): number | null {
    try {
      const binaryStr = globalThis.atob
        ? globalThis.atob(base64Value)
        : '';
      if (!binaryStr || binaryStr.length < 2) return null;
      const flags = binaryStr.charCodeAt(0);
      const is16Bit = (flags & 0x01) !== 0;
      if (is16Bit && binaryStr.length >= 3) {
        return binaryStr.charCodeAt(1) | (binaryStr.charCodeAt(2) << 8);
      }
      return binaryStr.charCodeAt(1);
    } catch {
      return null;
    }
  }

  async scanAndConnectHeartRateStrap(
    onHeartRateUpdate: (bpm: number, deviceName: string) => void,
    onStatusChange?: (statusText: string) => void
  ): Promise<void> {
    if (!this.manager) {
      onStatusChange?.('BLE requiere compilación APK nativa (usando sensor simulado)');
      return;
    }

    const hasPerm = await this.requestAndroidBlePermissions();
    if (!hasPerm) {
      onStatusChange?.('Permisos Bluetooth denegados en Android');
      return;
    }

    onStatusChange?.('Buscando banda BLE de frecuencia cardíaca...');

    this.manager.startDeviceScan(
      [HEART_RATE_SERVICE_UUID],
      { allowDuplicates: false },
      async (error, scannedDevice) => {
        if (error) {
          onStatusChange?.(`Error BLE: ${error.message}`);
          return;
        }

        if (scannedDevice) {
          this.manager?.stopDeviceScan();
          const devName = scannedDevice.name ?? 'Banda FC BLE';
          onStatusChange?.(`Conectando a ${devName}...`);

          try {
            const connected = await scannedDevice.connect();
            this.connectedDevice =
              await connected.discoverAllServicesAndCharacteristics();
            onStatusChange?.(`💙 Conectado a ${devName}`);

            this.connectedDevice.monitorCharacteristicForService(
              HEART_RATE_SERVICE_UUID,
              HEART_RATE_MEASUREMENT_CHAR_UUID,
              (charError, characteristic) => {
                if (charError || !characteristic?.value) return;
                const bpm = AndroidBleHeartRateService.decodeHeartRateBase64(
                  characteristic.value
                );
                if (bpm && bpm > 30 && bpm < 240) {
                  onHeartRateUpdate(bpm, devName);
                }
              }
            );
          } catch (connErr) {
            onStatusChange?.(
              `Fallo al conectar BLE: ${(connErr as Error).message}`
            );
          }
        }
      }
    );
  }

  async disconnect(): Promise<void> {
    this.manager?.stopDeviceScan();
    if (this.connectedDevice) {
      try {
        await this.connectedDevice.cancelConnection();
      } catch {
        // Ignorar desconexión previa
      }
      this.connectedDevice = null;
    }
  }
}
