// services/sslPinningService.ts
//
// Orchestrates dynamic SSL pinning:
//   1. Reads pin hashes from Firebase Remote Config (set there, never in source)
//   2. Pushes them to the native SslPinningModule
//   3. Validates the pin against the live backend URL
//   4. Runs MITM / instrumentation-tool detection
//
// Call order in App.tsx:
//   await initRemoteConfig()          ← fills RC values including ssl_pins
//   await initSslPinning()            ← this file – sends pins to native + validates
//   const mitmResult = await detectMitmAndTools()

import { NativeModules, Platform } from 'react-native';
import remoteConfig from '@react-native-firebase/remote-config';

// ─── Constants ────────────────────────────────────────────────────────────────

/** The Remote Config key whose value is a JSON array of SHA-256 SPKI pin strings.
 *  Example RC value:  ["sha256/AAAA…==", "sha256/BBBB…=="]
 *  (See README section "Adding pins to Firebase Remote Config" for full steps.)
 */
const RC_SSL_PINS_KEY = 'ssl_pins';

/** Primary backend host to validate after pinning is set up. */
const BACKEND_URL = 'https://iptv-backend-ds-585a.up.railway.app';

// ─── Native module bridge ─────────────────────────────────────────────────────

const { SslPinningModule } = NativeModules as {
  SslPinningModule: {
    /** Push pin hashes (fetched from RC) to the native layer. */
    setPins(pins: string[]): Promise<boolean>;
    /** HEAD-request [url] through the pinned OkHttpClient. Rejects on mismatch. */
    validatePin(url: string): Promise<boolean>;
    /** Full MITM + tool sweep. */
    detectMitmTools(): Promise<MitmDetectionResult>;
  };
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SslPinningResult {
  success: boolean;
  error?: string;
}

export interface MitmDetectionResult {
  detected: boolean;
  /** Machine-readable reason codes, e.g. "MITM_PACKAGE_INSTALLED" */
  reasons: string[];
  /** Package names of detected MITM apps (subset of reasons) */
  packages: string[];
}

// Human-readable labels shown to the user
const MITM_REASON_LABELS: Record<string, string> = {
  MITM_PACKAGE_INSTALLED:      'Network interception app detected',
  FRIDA_FILES_FOUND:           'Frida instrumentation tool files found',
  FRIDA_PACKAGE_INSTALLED:     'Frida instrumentation package installed',
  FRIDA_PORT_OPEN:             'Frida server port is open',
  SUSPICIOUS_PROXY_SETTING:    'System proxy is set to an interception address',
  UNTRUSTED_CA_IN_SYSTEM_STORE:'Untrusted CA certificate installed (Burp/Charles/mitmproxy)',
};

export function formatMitmReasons(reasons: string[]): string {
  return reasons
    .map(r => {
      // PROXY_PORT_OPEN:8080 → pretty label
      if (r.startsWith('PROXY_PORT_OPEN:')) {
        const port = r.split(':')[1];
        return `Proxy/interception port ${port} is open on device`;
      }
      return MITM_REASON_LABELS[r] ?? r;
    })
    .join('\n');
}

/** Maps detected package IDs to friendly app names for the user message. */
const PACKAGE_DISPLAY_NAMES: Record<string, string> = {
  'com.schiller.httpcanary':    'HTTP Canary',
  'app.greyshirts.sslcapture':  'SSL Capture',
  'com.httptoolkit.android':    'HTTP Toolkit',
  'com.minhui.networkcapture':  'Network Capture',
  'info.alphasoftware.pcapdroid':'PCAPdroid',
  'pcapdroid.test':             'PCAPdroid (test)',
  'org.sandroproxy.drony':      'Drony',
  'com.ddnstone.proxydroid':    'ProxyDroid',
  'org.proxydroid':             'ProxyDroid',
};

export function getDetectedAppNames(packages: string[]): string[] {
  return packages.map(p => PACKAGE_DISPLAY_NAMES[p] ?? p);
}

// ─── Main exports ─────────────────────────────────────────────────────────────

/**
 * initSslPinning()
 *
 * Reads pin hashes from an ALREADY-activated Remote Config instance,
 * sends them to the native module, then optionally validates the backend.
 *
 * Must be called AFTER initRemoteConfig() has resolved.
 *
 * On iOS: SSL pinning via native module is Android-only; this function
 * is a no-op on iOS (you'd use NSURLSession TLS challenge delegate instead).
 */
export async function initSslPinning(): Promise<SslPinningResult> {
  // iOS: skip — implement TLS challenge delegate in AppDelegate if needed
  if (Platform.OS !== 'android') {
    if (__DEV__) console.log('[SslPinning] Skipping (not Android)');
    return { success: true };
  }

  if (!SslPinningModule) {
    const msg = 'SslPinningModule native module not found. Did you register SslPinningPackage?';
    console.error('[SslPinning]', msg);
    return { success: false, error: msg };
  }

  try {
    // 1. Read pins from Remote Config ─────────────────────────────────────
    const raw = remoteConfig().getValue(RC_SSL_PINS_KEY).asString();

    if (!raw) {
      // No pins configured yet — warn in dev, allow in prod (graceful degradation)
      const msg = `Remote Config key "${RC_SSL_PINS_KEY}" is empty. SSL pinning inactive.`;
      console.warn('[SslPinning]', msg);
      if (__DEV__) return { success: true }; // dev: don't block
      // prod: treat as non-fatal so the app still works if RC is unreachable
      return { success: true };
    }

    let pins: string[];
    try {
      pins = JSON.parse(raw);
      if (!Array.isArray(pins) || pins.length === 0) throw new Error('empty array');
    } catch {
      return { success: false, error: `Invalid ssl_pins JSON in Remote Config: ${raw}` };
    }

    // 2. Push pins to the native module ───────────────────────────────────
    await SslPinningModule.setPins(pins);
    if (__DEV__) console.log('[SslPinning] Pins set:', pins);

    // 3. Validate the live backend certificate ────────────────────────────
    //    This double-checks that the pins we received actually match the
    //    real server — it would catch a compromised RC delivery.
    try {
      await SslPinningModule.validatePin(BACKEND_URL);
      if (__DEV__) console.log('[SslPinning] Backend pin validated ✓');
    } catch (e: any) {
      // PIN_MISMATCH means the cert on the server doesn't match the RC pins.
      // This can mean:
      //   a) Server cert was rotated and RC hasn't been updated yet → soft fail
      //   b) Active MITM is replacing the cert → hard fail
      // We treat it as a hard failure and let the caller decide.
      return {
        success: false,
        error: `Pin validation failed for ${BACKEND_URL}: ${e?.message ?? e}`,
      };
    }

    return { success: true };
  } catch (e: any) {
    return { success: false, error: e?.message ?? String(e) };
  }
}

/**
 * detectMitmAndTools()
 *
 * Runs the full native MITM/tool sweep.
 * Returns the raw result — callers are responsible for UI / blocking decisions.
 */
export async function detectMitmAndTools(): Promise<MitmDetectionResult> {
  if (Platform.OS !== 'android') {
    // Return clean result on iOS; add iOS-specific detection here if needed
    return { detected: false, reasons: [], packages: [] };
  }

  if (!SslPinningModule) {
    console.warn('[SslPinning] detectMitmAndTools: native module unavailable');
    return { detected: false, reasons: ['NATIVE_MODULE_MISSING'], packages: [] };
  }

  return SslPinningModule.detectMitmTools();
}
