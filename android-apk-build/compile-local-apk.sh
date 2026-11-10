#!/usr/bin/env bash
set -euo pipefail

TOOLCHAIN="/Users/benjamin.rodriguez/.gemini/antigravity/scratch/toolchain"
BUILD_DIR="/Users/benjamin.rodriguez/.gemini/antigravity/scratch/endomondo-neo/android-apk-build"
OUT_APK="/Users/benjamin.rodriguez/.gemini/antigravity/scratch/endomondo-neo/EndomondoNeo.apk"
WEB_APK="/Users/benjamin.rodriguez/.gemini/antigravity/scratch/endomondo-neo/web-panel/EndomondoNeo.apk"

export JAVA_HOME="$TOOLCHAIN/jdk17/Contents/Home"
export PATH="$JAVA_HOME/bin:$PATH"

BT_DIR="$(find "$TOOLCHAIN/build-tools" -maxdepth 1 -mindepth 1 -type d | head -n 1)"
PLAT_DIR="$(find "$TOOLCHAIN/platform-33" -maxdepth 1 -mindepth 1 -type d | head -n 1)"
ANDROID_JAR="$PLAT_DIR/android.jar"

cd "$BUILD_DIR"
rm -rf obj bin compiled_res assets/www
mkdir -p obj bin compiled_res assets/www
cp /Users/benjamin.rodriguez/.gemini/antigravity/scratch/endomondo-neo/web-panel/index.html assets/www/
cp /Users/benjamin.rodriguez/.gemini/antigravity/scratch/endomondo-neo/web-panel/styles.css assets/www/
cp /Users/benjamin.rodriguez/.gemini/antigravity/scratch/endomondo-neo/web-panel/app.js assets/www/
cp /Users/benjamin.rodriguez/.gemini/antigravity/scratch/endomondo-neo/web-panel/manifest.json assets/www/
cp /Users/benjamin.rodriguez/.gemini/antigravity/scratch/endomondo-neo/web-panel/sw.js assets/www/

echo "🎨 1/6 Compilando recursos modernos con aapt2 (resources.arsc sin comprimir para Android 14/15)..."
"$BT_DIR/aapt2" compile --dir res -o compiled_res/res.zip

echo "🔗 2/6 Enlazando AndroidManifest.xml, recursos y assets/www con aapt2 link (targetSdkVersion 34)..."
"$BT_DIR/aapt2" link \
  -I "$ANDROID_JAR" \
  --manifest AndroidManifest.xml \
  -A assets \
  --java obj \
  --min-sdk-version 26 \
  --target-sdk-version 34 \
  --version-code 3 \
  --version-name 1.2.0 \
  -o bin/EndomondoNeo.unaligned.apk \
  compiled_res/res.zip

echo "🔨 3/6 Compilando código nativo Android (MainActivity.java + R.java)..."
javac -source 1.8 -target 1.8 -bootclasspath "$ANDROID_JAR" -classpath "$ANDROID_JAR" -d obj src/com/endomondoneo/app/MainActivity.java obj/com/endomondoneo/app/R.java

echo "⚙️ 4/6 Generando bytecode Dalvik (classes.dex con d8)..."
"$BT_DIR/d8" --lib "$ANDROID_JAR" --output bin obj/com/endomondoneo/app/*.class

echo "➕ 5/6 Insertando classes.dex y alineando en límites de 4 bytes / página (-p -f 4)..."
cd bin
zip -q EndomondoNeo.unaligned.apk classes.dex
"$BT_DIR/zipalign" -p -f 4 EndomondoNeo.unaligned.apk EndomondoNeo.aligned.apk

echo "🔐 6/6 Firmando APK con apksigner (Esquemas V1 + V2 + V3)..."
"$BT_DIR/apksigner" sign \
  --v1-signing-enabled true \
  --v2-signing-enabled true \
  --v3-signing-enabled true \
  --ks "$BUILD_DIR/release-key.jks" \
  --ks-pass pass:endomondo123 \
  --key-pass pass:endomondo123 \
  --out "$OUT_APK" \
  EndomondoNeo.aligned.apk

"$BT_DIR/apksigner" verify --verbose "$OUT_APK"
cp "$OUT_APK" "$WEB_APK"
echo "✅ Nuevo APK v1.1.0 (targetSdkVersion 34 + aapt2) listo:"
ls -lh "$OUT_APK" "$WEB_APK"
