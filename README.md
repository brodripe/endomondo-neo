# 🟢 Endomondo Neo

Regeneración moderna de **Endomondo** que mantiene toda la operativa mítica de la aplicación original (multideporte, cuadrícula de 4 métricas personalizable, Audio Coach por kilómetro, Auto-Pausa, tabla de parciales/laps y *Peptalks* de amigos en vivo) combinada con la tecnología actual de los dispositivos móviles.

---

## 🚀 Características Principales

- **Tracking GPS Dual L1+L5 + Filtro de Kalman 2D**: Suavizado cinemático para eliminar saltos GPS en ciudad o montaña, cálculo de distancia Haversine 3D y desnivel positivo/negativo.
- **Auto-Pausa Inteligente con Histéresis**: Umbrales adaptativos según el deporte (Running, Trail Running, Ciclismo en Ruta, MTB, Caminata, Senderismo, Kayak, Patinaje, Esquí de fondo, Aguas abiertas).
- **Audio Coach con Síntesis de Voz y Audio Ducking**: Canta cada kilómetro, ritmo del último parcial, frecuencia cardíaca, ventaja o desventaja respecto al *Ghost Pacer* y lee los **Peptalks** enviados por amigos en tiempo real atenuando suavemente el volumen de Spotify/música.
- **Arquitectura Local-First (SQLite) + Cloud Sync (Supabase + PostGIS)**: Grabación instantánea a 1Hz en base de datos local `WAL` y sincronización en segundo plano con geometrías `LINESTRINGZ`.
- **Soporte Nativo Android (Foreground Service + Bluetooth LE)**:
  - Notificación persistente en segundo plano (`FOREGROUND_SERVICE_LOCATION`) para grabar con la pantalla apagada.
  - Conexión Bluetooth Low Energy (`0x180D` / `0x2A37`) para bandas de frecuencia cardíaca (Polar, Garmin, Coospo, Wahoo, Decathlon).
  - Bloqueo táctil contra lluvia/sudor y vibración háptica por vuelta.

---

## 📂 Estructura del Repositorio

- `mobile/` — Aplicación móvil **React Native + Expo + TypeScript** para Android e iOS.
- `web-panel/` — **Panel Web & Simulador Interactivo PWA** (Leaflet, Web Speech API, Web Bluetooth, exportador `.GPX`).
- `supabase/schema.sql` — Esquema **PostgreSQL + PostGIS** con soporte para rutas 3D, vueltas, récords personales, retos y *Peptalks* en tiempo real.
- `.github/workflows/build-android-apk.yml` — Pipeline de **GitHub Actions** para compilar automáticamente el archivo `.apk` de Android en cada push o manualmente.
