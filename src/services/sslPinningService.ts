// services/sslPinningService.ts

// ── CHANGE 1 ──────────────────────────────────────────────────────────────────
// Add DeviceEventEmitter to this import. It was missing before.
// Before: import { NativeModules, Platform } from 'react-native';
import { NativeModules, Platform, DeviceEventEmitter } from 'react-native';
import remoteConfig from '@react-native-firebase/remote-config';
import { APP_CONFIG } from '../constants/config';

// ─── Constants ────────────────────────────────────────────────────────────────
const RC_SSL_PINS_KEY = 'ssl_pins';
function getBackendUrl(): string {
  return APP_CONFIG.API_BASE_URL;
}

function getWsUrl(): string {
  return APP_CONFIG.API_BASE_URL
    .replace('https://', 'wss://')
    .replace('http://', 'ws://')
    + '/ws/pin-watch';
}
// ─── Native module bridge ─────────────────────────────────────────────────────
// ── CHANGE 2 ──────────────────────────────────────────────────────────────────
// Add startPinWatch and stopPinWatch to the type declaration.
// The original only had setPins, validatePin, detectMitmTools.
const { SslPinningModule } = NativeModules as {
  SslPinningModule: {
    setPins(pins: string[]): Promise<boolean>;
    validatePin(url: string): Promise<boolean>;
    detectMitmTools(): Promise<MitmDetectionResult>;
  startPinWatch(wsUrl: string): Promise<boolean>;  // ← add this line
    stopPinWatch(): Promise<boolean>;     // ← add this line
  };
};

// ─── Types ────────────────────────────────────────────────────────────────────
// Keep everything below exactly as it was — no changes here
export interface SslPinningResult {
  success: boolean;
  error?: string;
}

export interface MitmDetectionResult {
  detected: boolean;
  reasons: string[];
  packages: string[];
}

const MITM_REASON_LABELS: Record<string, string> = {
  MITM_PACKAGE_INSTALLED:       'Network interception app detected',
  FRIDA_FILES_FOUND:            'Frida instrumentation tool files found',
  FRIDA_PACKAGE_INSTALLED:      'Frida instrumentation package installed',
  FRIDA_PORT_OPEN:              'Frida server port is open',
  SUSPICIOUS_PROXY_SETTING:     'System proxy is set to an interception address',
  UNTRUSTED_CA_IN_SYSTEM_STORE: 'Untrusted CA certificate installed (Burp/Charles/mitmproxy)',
};

export function formatMitmReasons(reasons: string[]): string {
  return reasons
    .map(r => {
      if (r.startsWith('PROXY_PORT_OPEN:')) {
        const port = r.split(':')[1];
        return `Proxy/interception port ${port} is open on device`;
      }
      return MITM_REASON_LABELS[r] ?? r;
    })
    .join('\n');
}

const PACKAGE_DISPLAY_NAMES: Record<string, string> = {
  'com.guoshi.httpcanary':        'HTTP Canary',
  'app.greyshirts.sslcapture':    'SSL Capture',
  'com.httptoolkit.android':      'HTTP Toolkit',
  'com.minhui.networkcapture':    'Network Capture',
  'com.emanuelef.remote_capture': 'PCAPdroid',
  'pcapdroid.test':               'PCAPdroid (test)',
  'org.sandroproxy.drony':        'Drony',
  'com.ddnstone.proxydroid':      'ProxyDroid',
  'org.proxydroid':               'ProxyDroid',
};

export function getDetectedAppNames(packages: string[]): string[] {
  return packages.map(p => PACKAGE_DISPLAY_NAMES[p] ?? p);
}

// ─── initSslPinning — no changes here, keep exactly as it was ────────────────
export async function initSslPinning(): Promise<SslPinningResult> {
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
    const raw = remoteConfig().getValue(RC_SSL_PINS_KEY).asString();

    if (!raw) {
      const msg = `Remote Config key "${RC_SSL_PINS_KEY}" is empty. SSL pinning inactive.`;
      console.warn('[SslPinning]', msg);
      if (__DEV__) return { success: true };
      return { success: true };
    }

    let pins: string[];
    try {
      pins = JSON.parse(raw);
      if (!Array.isArray(pins) || pins.length === 0) throw new Error('empty array');
    } catch {
      return { success: false, error: `Invalid ssl_pins JSON in Remote Config: ${raw}` };
    }

    await SslPinningModule.setPins(pins);
    if (__DEV__) console.log('[SslPinning] Pins set:', pins);

    try {
await SslPinningModule.validatePin(getBackendUrl());
      if (__DEV__) console.log('[SslPinning] Backend pin validated ✓');
    } catch (e: any) {
      if (e?.code === 'PIN_MISMATCH') throw e;
      return {
        success: false,
        error: `Pin validation failed : ${e?.message ?? e}`,
      };
    }

    return { success: true };
  } catch (e: any) {
    return { success: false, error: e?.message ?? String(e) };
  }
}

// ─── detectMitmAndTools — no changes here, keep exactly as it was ─────────────
export async function detectMitmAndTools(): Promise<MitmDetectionResult> {
  if (Platform.OS !== 'android') {
    return { detected: false, reasons: [], packages: [] };
  }
  if (!SslPinningModule) {
    console.warn('[SslPinning] detectMitmAndTools: native module unavailable');
    return { detected: false, reasons: ['NATIVE_MODULE_MISSING'], packages: [] };
  }
  return SslPinningModule.detectMitmTools();
}

// ── CHANGE 3 ──────────────────────────────────────────────────────────────────
// Add these three functions at the bottom of the file. They did not exist before.

/**
 * Opens a persistent pinned WebSocket to the backend.
 * TLS pin is verified on every connect and reconnect.
 * Kill fires instantly on mismatch — no polling window.
 * Call AFTER initSslPinning() resolves.
 */
export function startPinWatch(): void {
  if (Platform.OS !== 'android' || !SslPinningModule) return;
  SslPinningModule.startPinWatch(getWsUrl()).catch((e: any) =>
    console.error('[SslPinning] startPinWatch failed:', e)
  );
}
/**
 * Closes the WebSocket and pauses the watch.
 * Call when the app goes to background to save battery.
 */
export function stopPinWatch(): void {
  if (Platform.OS !== 'android' || !SslPinningModule) return;
  SslPinningModule.stopPinWatch().catch(() => {});
}

/**
 * Register a callback for the ~150ms window before the process is killed.
 * Use it to wipe stream URLs, auth tokens, and any sensitive state from memory.
 * Returns an unsubscribe function — call it in your cleanup/useEffect return.
 */
export function onMitmKill(callback: (reason: string) => void): () => void {
  const sub = DeviceEventEmitter.addListener('SslPinMismatchDetected', callback);
  return () => sub.remove();
}