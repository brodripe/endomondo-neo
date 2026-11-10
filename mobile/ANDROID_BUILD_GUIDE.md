# Guía de Compilación e Instalación Android (.APK) — Endomondo Neo

El proyecto móvil en [`mobile/`](file:///Users/benjamin.rodriguez/.gemini/antigravity/scratch/endomondo-neo/mobile) está configurado con todos los permisos y servicios nativos de **Android 10 a Android 15 (API 29–35)**:
- **Foreground Location Service** (`FOREGROUND_SERVICE_LOCATION` + `ACCESS_BACKGROUND_LOCATION`): mantiene una notificación fija en la barra de estado de Android y evita que el sistema operativo detenga el GPS cuando apagas la pantalla o guardas el móvil en el bolsillo.
- **Bluetooth Low Energy (BLE)** (`BLUETOOTH_SCAN` + `BLUETOOTH_CONNECT`): lectura en tiempo real de bandas cardíacas (Polar, Garmin, Coospo, Wahoo, Decathlon) mediante el servicio GATT estándar `0x180D`.
- **Audio Coach con Audio Ducking** (`InterruptionModeAndroid.DuckOthers`): atenúa automáticamente el volumen de Spotify o YouTube Music cuando el entrenador canta un kilómetro y lo restaura al terminar la frase.
- **Bloqueo táctil contra lluvia/sudor** y **vibración háptica** en cada vuelta de 1 km.

---

## Opción 1: Generar el archivo `.APK` en la nube (Sin instalar Android Studio)

Si quieres obtener un archivo `.apk` descargable mediante código QR sin configurar el SDK de Android en tu ordenador:

```bash
cd /Users/benjamin.rodriguez/.gemini/antigravity/scratch/endomondo-neo/mobile
./build-android-apk.sh cloud
```
*(Usa el perfil `preview` de [`eas.json`](file:///Users/benjamin.rodriguez/.gemini/antigravity/scratch/endomondo-neo/mobile/eas.json) configurado con `"buildType": "apk"`).*

---

## Opción 2: Compilar el `.APK` localmente con Gradle

Si tienes **Android Studio / Android SDK** instalado en tu equipo:

```bash
cd /Users/benjamin.rodriguez/.gemini/antigravity/scratch/endomondo-neo/mobile
./build-android-apk.sh local
```

Esto ejecutará `npx expo prebuild --platform android` (generando el `AndroidManifest.xml` con los permisos de Foreground Service y Bluetooth) y compilará el instalador en:
`mobile/android/app/build/outputs/apk/release/app-release.apk`

Para instalarlo directamente por cable USB con `adb`:
```bash
adb install -r android/app/build/outputs/apk/release/app-release.apk
```
