package com.endomondoneo.app;

import android.Manifest;
import android.accounts.AccountManager;
import android.app.Activity;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanResult;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

public class MainActivity extends Activity implements TextToSpeech.OnInitListener, SensorEventListener {
    private static final int PERMISSIONS_REQUEST_CODE = 1001;
    private static final int GOOGLE_ACCOUNT_PICKER_REQUEST_CODE = 2002;
    private static final String PREFS_CRASHLYTICS = "EndomondoCrashlyticsPrefs";

    // UUIDs estándar Bluetooth GATT para sensores deportivos
    private static final UUID UUID_HEART_RATE_SERVICE =
        UUID.fromString("0000180d-0000-1000-8000-00805f9b34fb");
    private static final UUID UUID_HEART_RATE_MEASUREMENT =
        UUID.fromString("00002a37-0000-1000-8000-00805f9b34fb");
    private static final UUID UUID_RSC_SERVICE =
        UUID.fromString("00001814-0000-1000-8000-00805f9b34fb");
    private static final UUID UUID_RSC_MEASUREMENT =
        UUID.fromString("00002a53-0000-1000-8000-00805f9b34fb");
    private static final UUID UUID_CYCLING_POWER_SERVICE =
        UUID.fromString("00001818-0000-1000-8000-00805f9b34fb");
    private static final UUID UUID_CYCLING_POWER_MEASUREMENT =
        UUID.fromString("00002a63-0000-1000-8000-00805f9b34fb");
    private static final UUID UUID_CLIENT_CHAR_CONFIG =
        UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");

    private WebView webView;
    private TextToSpeech tts;
    private boolean ttsReady = false;
    private AudioManager audioManager;
    private AudioFocusRequest focusRequest;

    // Bluetooth LE Nativo
    private BluetoothAdapter bluetoothAdapter;
    private BluetoothLeScanner bleScanner;
    private BluetoothGatt activeGatt;
    private boolean isScanningBle = false;
    private final Map<String, BluetoothDevice> discoveredBleDevices = new HashMap<String, BluetoothDevice>();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    // Sensor de pasos / cadencia nativo del teléfono
    private SensorManager sensorManager;
    private int initialStepCount = -1;
    private long lastStepTimestampMs = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        setupNativeCrashlyticsHandler();

        Window window = getWindow();
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            window.setStatusBarColor(Color.parseColor("#0d1217"));
            window.setNavigationBarColor(Color.parseColor("#0d1217"));
        }

        audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        tts = new TextToSpeech(this, this);

        BluetoothManager btManager = (BluetoothManager) getSystemService(Context.BLUETOOTH_SERVICE);
        if (btManager != null) {
            bluetoothAdapter = btManager.getAdapter();
        }

        sensorManager = (SensorManager) getSystemService(Context.SENSOR_SERVICE);
        if (sensorManager != null) {
            Sensor stepSensor = sensorManager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER);
            if (stepSensor != null) {
                sensorManager.registerListener(this, stepSensor, SensorManager.SENSOR_DELAY_UI);
            }
        }

        requestAllRuntimePermissions();

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#0d1217"));

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setGeolocationEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setUserAgentString("EndomondoNeo/1.5 (Android; Mobile; OpenStreetMap)");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }

        webView.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");

        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(
                String origin,
                GeolocationPermissions.Callback callback
            ) {
                callback.invoke(origin, true, false);
            }
        });

        setContentView(webView);
        webView.loadUrl("file:///android_asset/www/index.html");
    }

    private void requestAllRuntimePermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            requestPermissions(
                new String[] {
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION,
                    "android.permission.BLUETOOTH_SCAN",
                    "android.permission.BLUETOOTH_CONNECT",
                    "android.permission.ACTIVITY_RECOGNITION"
                },
                PERMISSIONS_REQUEST_CODE
            );
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            requestPermissions(
                new String[] {
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION
                },
                PERMISSIONS_REQUEST_CODE
            );
        }
    }

    private final ScanCallback bleScanCallback = new ScanCallback() {
        @Override
        public void onScanResult(int callbackType, ScanResult result) {
            if (result == null || result.getDevice() == null) return;
            BluetoothDevice device = result.getDevice();
            String address = device.getAddress();
            String name = device.getName();
            if (name == null || name.trim().isEmpty()) {
                return;
            }
            discoveredBleDevices.put(address, device);
            final String safeName = name.replace("'", "").replace("\"", "");
            final String safeAddr = address.replace("'", "");
            final int rssi = result.getRssi();

            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    webView.evaluateJavascript(
                        "window.onAndroidBleDeviceFound && window.onAndroidBleDeviceFound('"
                            + safeAddr + "','" + safeName + "'," + rssi + ");",
                        null
                    );
                }
            });
        }
    };

    private final BluetoothGattCallback gattCallback = new BluetoothGattCallback() {
        @Override
        public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
            final String devName = gatt.getDevice() != null && gatt.getDevice().getName() != null
                ? gatt.getDevice().getName().replace("'", "")
                : "Sensor BLE";
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                gatt.discoverServices();
                notifyJsBleStatus("Conectado a " + devName, true, devName);
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                notifyJsBleStatus("Desconectado de " + devName, false, devName);
            }
        }

        @Override
        public void onServicesDiscovered(BluetoothGatt gatt, int status) {
            if (status != BluetoothGatt.GATT_SUCCESS) return;

            // 1. Suscribirse a Frecuencia Cardíaca (0x180D -> 0x2A37)
            BluetoothGattService hrService = gatt.getService(UUID_HEART_RATE_SERVICE);
            if (hrService != null) {
                BluetoothGattCharacteristic hrChar =
                    hrService.getCharacteristic(UUID_HEART_RATE_MEASUREMENT);
                enableCharacteristicNotification(gatt, hrChar);
            }

            // 2. Suscribirse a Cadencia/Velocidad Running (0x1814 -> 0x2A53)
            BluetoothGattService rscService = gatt.getService(UUID_RSC_SERVICE);
            if (rscService != null) {
                BluetoothGattCharacteristic rscChar =
                    rscService.getCharacteristic(UUID_RSC_MEASUREMENT);
                enableCharacteristicNotification(gatt, rscChar);
            }

            // 3. Suscribirse a Potencia Ciclismo (0x1818 -> 0x2A63)
            BluetoothGattService pwrService = gatt.getService(UUID_CYCLING_POWER_SERVICE);
            if (pwrService != null) {
                BluetoothGattCharacteristic pwrChar =
                    pwrService.getCharacteristic(UUID_CYCLING_POWER_MEASUREMENT);
                enableCharacteristicNotification(gatt, pwrChar);
            }
        }

        @Override
        public void onCharacteristicChanged(
            BluetoothGatt gatt,
            BluetoothGattCharacteristic characteristic
        ) {
            UUID uuid = characteristic.getUuid();
            byte[] data = characteristic.getValue();
            if (data == null || data.length == 0) return;

            if (UUID_HEART_RATE_MEASUREMENT.equals(uuid) && data.length >= 2) {
                int flags = data[0] & 0xFF;
                final int bpm;
                if ((flags & 0x01) != 0 && data.length >= 3) {
                    bpm = (data[1] & 0xFF) | ((data[2] & 0xFF) << 8);
                } else {
                    bpm = data[1] & 0xFF;
                }
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        webView.evaluateJavascript(
                            "window.onAndroidBleHeartRate && window.onAndroidBleHeartRate(" + bpm + ");",
                            null
                        );
                    }
                });
            } else if (UUID_RSC_MEASUREMENT.equals(uuid) && data.length >= 4) {
                final int cadenceSpm = data[3] & 0xFF;
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        webView.evaluateJavascript(
                            "window.onAndroidBleCadence && window.onAndroidBleCadence(" + cadenceSpm + ");",
                            null
                        );
                    }
                });
            } else if (UUID_CYCLING_POWER_MEASUREMENT.equals(uuid) && data.length >= 4) {
                final int watts = (data[2] & 0xFF) | ((data[3] & 0xFF) << 8);
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        webView.evaluateJavascript(
                            "window.onAndroidBlePower && window.onAndroidBlePower(" + watts + ");",
                            null
                        );
                    }
                });
            }
        }
    };

    private void enableCharacteristicNotification(
        BluetoothGatt gatt,
        BluetoothGattCharacteristic characteristic
    ) {
        if (characteristic == null) return;
        gatt.setCharacteristicNotification(characteristic, true);
        BluetoothGattDescriptor descriptor =
            characteristic.getDescriptor(UUID_CLIENT_CHAR_CONFIG);
        if (descriptor != null) {
            descriptor.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
            gatt.writeDescriptor(descriptor);
        }
    }

    private void notifyJsBleStatus(final String text, final boolean connected, final String devName) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                webView.evaluateJavascript(
                    "window.onAndroidBleConnectionState && window.onAndroidBleConnectionState("
                        + connected + ",'" + devName + "','" + text.replace("'", "") + "');",
                    null
                );
            }
        });
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        if (event != null && event.sensor.getType() == Sensor.TYPE_STEP_COUNTER) {
            int totalSteps = (int) event.values[0];
            if (initialStepCount < 0) {
                initialStepCount = totalSteps;
            }
            final int sessionSteps = Math.max(0, totalSteps - initialStepCount);
            long now = System.currentTimeMillis();
            if (now - lastStepTimestampMs > 2000 && webView != null) {
                lastStepTimestampMs = now;
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        webView.evaluateJavascript(
                            "window.onAndroidStepCounter && window.onAndroidStepCounter(" + sessionSteps + ");",
                            null
                        );
                    }
                });
            }
        }
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {
    }

    private void setupNativeCrashlyticsHandler() {
        final Thread.UncaughtExceptionHandler defaultHandler =
            Thread.getDefaultUncaughtExceptionHandler();

        Thread.setDefaultUncaughtExceptionHandler(new Thread.UncaughtExceptionHandler() {
            @Override
            public void uncaughtException(Thread thread, Throwable throwable) {
                try {
                    StringWriter sw = new StringWriter();
                    PrintWriter pw = new PrintWriter(sw);
                    throwable.printStackTrace(pw);
                    String stackTrace = sw.toString();

                    SharedPreferences prefs = getSharedPreferences(
                        PREFS_CRASHLYTICS,
                        Context.MODE_PRIVATE
                    );
                    prefs.edit()
                        .putString("pending_native_crash_msg", throwable.toString())
                        .putString("pending_native_crash_stack", stackTrace)
                        .putLong("pending_native_crash_ts", System.currentTimeMillis())
                        .commit();
                } catch (Exception ignored) {
                }

                if (defaultHandler != null) {
                    defaultHandler.uncaughtException(thread, throwable);
                }
            }
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == GOOGLE_ACCOUNT_PICKER_REQUEST_CODE) {
            if (resultCode == RESULT_OK && data != null) {
                final String accountEmail =
                    data.getStringExtra(AccountManager.KEY_ACCOUNT_NAME);
                if (accountEmail != null && !accountEmail.isEmpty()) {
                    final String safeEmail = accountEmail.replace("'", "\\'");
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            webView.evaluateJavascript(
                                "window.onAndroidGoogleSignInSuccess && window.onAndroidGoogleSignInSuccess('"
                                    + safeEmail + "');",
                                null
                            );
                        }
                    });
                    return;
                }
            }
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    webView.evaluateJavascript(
                        "window.onAndroidGoogleSignInFallback && window.onAndroidGoogleSignInFallback();",
                        null
                    );
                }
            });
        }
    }

    @Override
    public void onInit(int status) {
        if (status == TextToSpeech.SUCCESS) {
            int result = tts.setLanguage(new Locale("es", "ES"));
            if (result != TextToSpeech.LANG_MISSING_DATA
                && result != TextToSpeech.LANG_NOT_SUPPORTED) {
                ttsReady = true;
            } else {
                tts.setLanguage(Locale.getDefault());
                ttsReady = true;
            }
            tts.setSpeechRate(1.03f);
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override
                public void onStart(String utteranceId) {
                    requestAudioDucking(true);
                }

                @Override
                public void onDone(String utteranceId) {
                    requestAudioDucking(false);
                }

                @Override
                public void onError(String utteranceId) {
                    requestAudioDucking(false);
                }
            });
        }
    }

    private void requestAudioDucking(boolean duck) {
        if (audioManager == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (duck) {
                AudioAttributes attrs = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build();
                focusRequest = new AudioFocusRequest.Builder(
                    AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK
                )
                    .setAudioAttributes(attrs)
                    .build();
                audioManager.requestAudioFocus(focusRequest);
            } else if (focusRequest != null) {
                audioManager.abandonAudioFocusRequest(focusRequest);
            }
        }
    }

    public class AndroidBridge {
        @JavascriptInterface
        public void speak(String text) {
            if (tts != null && ttsReady && text != null && !text.isEmpty()) {
                Bundle params = new Bundle();
                params.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, 1.0f);
                tts.speak(
                    text,
                    TextToSpeech.QUEUE_ADD,
                    params,
                    "endo_utt_" + System.currentTimeMillis()
                );
            }
        }

        @JavascriptInterface
        public void vibrate(int durationMs) {
            Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null && v.hasVibrator()) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    v.vibrate(
                        VibrationEffect.createOneShot(
                            durationMs,
                            VibrationEffect.DEFAULT_AMPLITUDE
                        )
                    );
                } else {
                    v.vibrate(durationMs);
                }
            }
        }

        @JavascriptInterface
        public void startBleSensorScan() {
            requestAllRuntimePermissions();
            if (bluetoothAdapter == null || !bluetoothAdapter.isEnabled()) {
                notifyJsBleStatus("Activa el Bluetooth en tu móvil Android", false, "");
                return;
            }
            bleScanner = bluetoothAdapter.getBluetoothLeScanner();
            if (bleScanner == null) {
                notifyJsBleStatus("Escáner BLE no disponible", false, "");
                return;
            }
            if (isScanningBle) {
                bleScanner.stopScan(bleScanCallback);
            }
            discoveredBleDevices.clear();
            isScanningBle = true;
            bleScanner.startScan(bleScanCallback);

            // Detener escaneo tras 12 segundos para ahorrar batería
            mainHandler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    if (isScanningBle && bleScanner != null) {
                        bleScanner.stopScan(bleScanCallback);
                        isScanningBle = false;
                    }
                }
            }, 12000);
        }

        @JavascriptInterface
        public void connectBleDeviceByAddress(String address) {
            if (bleScanner != null && isScanningBle) {
                bleScanner.stopScan(bleScanCallback);
                isScanningBle = false;
            }
            BluetoothDevice device = discoveredBleDevices.get(address);
            if (device == null && bluetoothAdapter != null) {
                try {
                    device = bluetoothAdapter.getRemoteDevice(address);
                } catch (Exception ignored) {
                }
            }
            if (device != null) {
                if (activeGatt != null) {
                    activeGatt.close();
                }
                activeGatt = device.connectGatt(MainActivity.this, false, gattCallback);
            }
        }

        @JavascriptInterface
        public void disconnectBleSensor() {
            if (activeGatt != null) {
                activeGatt.disconnect();
                activeGatt.close();
                activeGatt = null;
            }
        }

        @JavascriptInterface
        public void signInWithGoogle() {
            try {
                Intent intent;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    intent = AccountManager.newChooseAccountIntent(
                        null,
                        null,
                        new String[] {"com.google"},
                        null,
                        null,
                        null,
                        null
                    );
                } else {
                    intent = AccountManager.newChooseAccountIntent(
                        null,
                        null,
                        new String[] {"com.google"},
                        false,
                        null,
                        null,
                        null,
                        null
                    );
                }
                startActivityForResult(intent, GOOGLE_ACCOUNT_PICKER_REQUEST_CODE);
            } catch (Exception e) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        webView.evaluateJavascript(
                            "window.onAndroidGoogleSignInFallback && window.onAndroidGoogleSignInFallback();",
                            null
                        );
                    }
                });
            }
        }

        @JavascriptInterface
        public String getDeviceInfoJson() {
            String manufacturer = Build.MANUFACTURER != null ? Build.MANUFACTURER : "Android";
            String model = Build.MODEL != null ? Build.MODEL : "Phone";
            String release = Build.VERSION.RELEASE != null ? Build.VERSION.RELEASE : "14";
            int sdk = Build.VERSION.SDK_INT;
            return "{\"manufacturer\":\"" + manufacturer.replace("\"", "")
                + "\",\"model\":\"" + model.replace("\"", "")
                + "\",\"androidVersion\":\"" + release.replace("\"", "")
                + "\",\"sdkInt\":" + sdk + ",\"appVersion\":\"1.5.0\"}";
        }

        @JavascriptInterface
        public String consumePendingNativeCrashJson() {
            SharedPreferences prefs = getSharedPreferences(
                PREFS_CRASHLYTICS,
                Context.MODE_PRIVATE
            );
            String msg = prefs.getString("pending_native_crash_msg", null);
            if (msg == null) return "";
            String stack = prefs.getString("pending_native_crash_stack", "");
            long ts = prefs.getLong("pending_native_crash_ts", System.currentTimeMillis());
            prefs.edit().clear().commit();
            return "{\"message\":\"" + msg.replace("\"", "'").replace("\n", " ")
                + "\",\"stack\":\"" + stack.replace("\"", "'").replace("\n", "\\n")
                + "\",\"ts\":" + ts + "}";
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (sensorManager != null) {
            sensorManager.unregisterListener(this);
        }
        if (activeGatt != null) {
            activeGatt.close();
        }
        if (tts != null) {
            tts.stop();
            tts.shutdown();
        }
        super.onDestroy();
    }
}
