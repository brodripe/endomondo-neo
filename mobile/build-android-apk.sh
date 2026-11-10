#!/usr/bin/env bash
set -euo pipefail

echo "============================================================"
echo "🟢 ENDOMONDO NEO — GENERADOR DE APK ANDROID"
echo "============================================================"

cd "$(dirname "$0")"

if ! command -v npx >/dev/null 2>&1; then
  echo "❌ Error: Node.js / npx no se encuentra en el PATH."
  echo "Instala Node.js LTS (https://nodejs.org) y vuelve a ejecutar este script."
  exit 1
fi

MODE="${1:-local}"

echo "📦 Instalando dependencias del proyecto..."
npm install

if [ "$MODE" = "cloud" ]; then
  echo "☁️ Compilando APK en la nube con EAS Build (no requiere Android Studio local)..."
  npx eas-cli build --platform android --profile preview
else
  echo "🤖 Generando carpeta nativa Android (Prebuild con Foreground Service + BLE)..."
  npx expo prebuild --platform android --clean

  echo "🔨 Compilando APK Release con Gradle..."
  cd android
  ./gradlew assembleRelease

  APK_PATH="app/build/outputs/apk/release/app-release.apk"
  echo "✅ ¡APK generado con éxito!"
  echo "📍 Ruta del archivo: $(pwd)/$APK_PATH"
fi
