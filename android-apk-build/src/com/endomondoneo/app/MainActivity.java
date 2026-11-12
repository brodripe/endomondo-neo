package com.endomondoneo.app;

import android.Manifest;
import android.accounts.AccountManager;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
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
import java.util.Locale;

public class MainActivity extends Activity implements TextToSpeech.OnInitListener {
    private static final int LOCATION_PERMISSION_REQUEST_CODE = 1001;
    private static final int GOOGLE_ACCOUNT_PICKER_REQUEST_CODE = 2002;
    private static final String PREFS_CRASHLYTICS = "EndomondoCrashlyticsPrefs";
    private WebView webView;
    private TextToSpeech tts;
    private boolean ttsReady = false;
    private AudioManager audioManager;
    private AudioFocusRequest focusRequest;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Instalar manejador nativo de Crashlytics para excepciones Java no controladas
        setupNativeCrashlyticsHandler();

        Window window = getWindow();
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            window.setStatusBarColor(Color.parseColor("#0d1217"));
            window.setNavigationBarColor(Color.parseColor("#0d1217"));
        }

        audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        tts = new TextToSpeech(this, this);

        requestLocationPermissionsIfNeeded();

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
        settings.setUserAgentString("EndomondoNeo/1.4 (Android; Mobile; OpenStreetMap)");
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

    private void requestLocationPermissionsIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(
                    new String[] {
                        Manifest.permission.ACCESS_FINE_LOCATION,
                        Manifest.permission.ACCESS_COARSE_LOCATION
                    },
                    LOCATION_PERMISSION_REQUEST_CODE
                );
            }
        }
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
                + "\",\"sdkInt\":" + sdk + ",\"appVersion\":\"1.4.0\"}";
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
        if (tts != null) {
            tts.stop();
            tts.shutdown();
        }
        super.onDestroy();
    }
}
