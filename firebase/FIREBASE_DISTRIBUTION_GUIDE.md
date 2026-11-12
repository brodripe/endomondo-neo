# 🚀 Guía de Distribución de Endomondo Neo con Firebase

Tienes **dos formas complementarias** en tu proyecto **`endomondo-neo`** de Firebase para distribuir la aplicación a tus amigos y testers:

---

## Vía 1: Firebase App Distribution (Subir el `.APK` en 30 segundos y enviar invitaciones a amigos)

**Firebase App Distribution** es la herramienta oficial de Google para distribuir archivos `.apk` a tus amigos sin tener que pasar por la revisión de Google Play Store. Ellos reciben un correo oficial de Firebase o un enlace de invitación para instalar la app y reciben avisos cada vez que subes una actualización.

### Pasos en tu consola de Firebase:

1. **Registrar la App Android en tu proyecto `endomondo-neo`**:
   - Entra en **Configuración del proyecto** (la rueda dentada ⚙️ arriba a la izquierda → *Configuración del proyecto*).
   - Abajo, en la sección **Tus apps**, haz clic en el **icono redondo azul de Android (🤖)** (*Añadir app → Android*).
   - En **Nombre del paquete de Android**, escribe exactamente:
     ```text
     com.endomondoneo.app
     ```
   - En *Sobrenombre de la app*, pon `Endomondo Neo Android` y pulsa **Registrar app** (puedes pulsar *Siguiente / Omitir* en los pasos siguientes).

2. **Subir el APK a Firebase App Distribution**:
   - En el menú lateral izquierdo de Firebase, despliega **DevOps y participación ▸** (o *Compilación / Lanzamiento y supervisión*) y haz clic en **App Distribution**.
   - Pulsa **Comenzar** (*Get started*).
   - En la pestaña **Versiones (Releases)**, **arrastra y suelta** directamente tu archivo [EndomondoNeo-v8.apk](file:///Users/benjamin.rodriguez/.gemini/antigravity/scratch/endomondo-neo/EndomondoNeo-v8.apk).

3. **Invitar a tus amigos**:
   - Ve a la pestaña **Testers y grupos** → crea un grupo llamado `amigos` o añade los correos `@gmail.com` de tus amigos.
   - También puedes ir a la pestaña **Enlaces de invitación** → **Nuevo enlace de invitación**: te dará una URL pública de Firebase (`https://appdistribution.firebase.dev/i/...`) que puedes compartir por WhatsApp para que cualquiera de tus amigos se registre y descargue el APK con un toque.

---

## Vía 2: Distribución Automática desde GitHub Actions (App Distribution + Firebase Hosting `https://endomondo-neo.web.app`)

Ya he dejado configurados en el repositorio:
- [.firebaserc](file:///Users/benjamin.rodriguez/.gemini/antigravity/scratch/endomondo-neo/.firebaserc) apuntando a tu proyecto `endomondo-neo`.
- [firebase.json](file:///Users/benjamin.rodriguez/.gemini/antigravity/scratch/endomondo-neo/firebase.json) configurado para servir la aplicación web y el archivo `.apk` con las cabeceras MIME de instalación de Android (`application/vnd.android.package-archive`).
- [.github/workflows/firebase-distribute.yml](file:///Users/benjamin.rodriguez/.gemini/antigravity/scratch/endomondo-neo/.github/workflows/firebase-distribute.yml): Compila y firma el `.apk` en menos de 30 segundos en cada `push` a GitHub y, si añades los secretos `FIREBASE_ANDROID_APP_ID` y `FIREBASE_SERVICE_ACCOUNT` en tu repositorio de GitHub (*Settings → Secrets and variables → Actions*), lo publica automáticamente tanto en **Firebase App Distribution** como en **`https://endomondo-neo.web.app`**.
