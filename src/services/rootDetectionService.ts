// src/services/rootDetectionService.ts
//
// Orchestrates all root / tamper detection BEFORE any API or Firebase call.
// Combines the Kotlin native module (heavy checks) with JS-side soft checks
// (debugger, console override detection, timing anomalies from Frida hooks).

import { NativeModules, Platform } from 'react-native';

const { RootDetection } = NativeModules;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RootCheckResult {
  rooted: boolean;
  reasons: string[];
  source: 'native' | 'js' | 'combined';
}

// ─── JS-side soft checks ──────────────────────────────────────────────────────
// These are lightweight guards that catch cases Frida/JS hooking might introduce
// even before the native module runs.

function jsCheckDebugger(): boolean {
  // Classic JS debugger timing side-channel
  const start = Date.now();
  // eslint-disable-next-line no-debugger
  debugger; // Pauses only if DevTools is attached
  const elapsed = Date.now() - start;
  return elapsed > 900; // Debugger breakpoint adds significant delay
}

function jsCheckConsoleOverride(): boolean {
  // Frida / Objection often replaces console.log to intercept logs
  // A native function's toString returns "function log() { [native code] }"
  const nativeLog = console.log.toString();
  if (!nativeLog.includes('[native code]') && !nativeLog.includes('bound ')) {
    return true; // Console has been monkey-patched
  }
  return false;
}

function jsCheckObjectPrototypeTampering(): boolean {
  // Xposed / Frida hooks sometimes leave traces on Object.prototype
  const obj = {};
  const proto = Object.getPrototypeOf(obj);
  const ownKeys = Object.getOwnPropertyNames(proto);
  // Standard keys only: constructor, hasOwnProperty, isPrototypeOf,
  // propertyIsEnumerable, toString, toLocaleString, valueOf, __defineGetter__,
  // __defineSetter__, __lookupGetter__, __lookupSetter__, __proto__
  const EXPECTED_MAX_PROTO_KEYS = 15;
  return ownKeys.length > EXPECTED_MAX_PROTO_KEYS;
}

function jsCheckTimingAnomaly(): boolean {
  const iterations = 10_000;

  const start = Date.now();

  let acc = 0;
  for (let i = 0; i < iterations; i++) {
    acc += i * Math.random();
  }

  const elapsed = Date.now() - start;

  void acc;

  return elapsed > 80;
}

function runJSChecks(): string[] {
  const reasons: string[] = [];
  try {
    if (__DEV__ === false && jsCheckDebugger()) reasons.push('JS_DEBUGGER_ATTACHED');
  } catch { /* ignore */ }
  try {
    if (jsCheckConsoleOverride()) reasons.push('JS_CONSOLE_HOOKED');
  } catch { /* ignore */ }
  try {
    if (jsCheckObjectPrototypeTampering()) reasons.push('JS_PROTOTYPE_TAMPERED');
  } catch { /* ignore */ }
  try {
    if (__DEV__ === false && jsCheckTimingAnomaly()) reasons.push('JS_TIMING_ANOMALY');
  } catch { /* ignore */ }
  return reasons;
}

// ─── Native module guard ──────────────────────────────────────────────────────

async function runNativeChecks(): Promise<{ rooted: boolean; reasons: string[] }> {
  if (Platform.OS !== 'android') {
    // iOS root detection is a separate concern; allow for now
    return { rooted: false, reasons: [] };
  }

  if (!RootDetection) {
    // Module not linked — fail-secure in production, allow in dev
    if (__DEV__) {
      console.warn('[RootDetection] Native module not found. Skipping in dev mode.');
      return { rooted: false, reasons: [] };
    }
    return { rooted: true, reasons: ['NATIVE_MODULE_MISSING'] };
  }

  try {
    const result = await RootDetection.isRooted();
    return {
      rooted: result.rooted === true,
      reasons: result.reasons ?? [],
    };
  } catch (e: any) {
    // Any native error → fail-secure
    return { rooted: true, reasons: ['NATIVE_CHECK_EXCEPTION'] };
  }
}

// ─── Kill switch ──────────────────────────────────────────────────────────────

export async function killApp(): Promise<void> {
  try {
    if (RootDetection?.killApp) {
      await RootDetection.killApp();
    }
  } catch { /* last resort */ }
}

// ─── Main exported function ───────────────────────────────────────────────────

let _cached: RootCheckResult | null = null;
let _checking = false;
let _checkPromise: Promise<RootCheckResult> | null = null;

/**
 * Runs all root / tamper checks. Results are cached for the session so
 * every API call guard doesn't repeat the full scan.
 *
 * @param force  Set true to bypass the cache (e.g. for periodic re-checks).
 */
export async function performRootCheck(force = false): Promise<RootCheckResult> {
  if (!force && _cached) return _cached;

  // Deduplicate concurrent callers
  if (_checking && _checkPromise) return _checkPromise;

  _checking = true;
  _checkPromise = (async (): Promise<RootCheckResult> => {
    try {
      const [native, jsReasons] = await Promise.all([
        runNativeChecks(),
        Promise.resolve(runJSChecks()),
      ]);

      const allReasons = [...native.reasons, ...jsReasons];
      const rooted = native.rooted || jsReasons.length > 0;

      const result: RootCheckResult = {
        rooted,
        reasons: allReasons,
        source: 'combined',
      };

      _cached = result;
      return result;
    } finally {
      _checking = false;
      _checkPromise = null;
    }
  })();

  return _checkPromise;
}

/**
 * Convenience guard — call this at the top of any API/Firebase function.
 * Throws if the device is rooted/tampered.
 *
 * Usage:
 *   await assertNotRooted();
 *   const data = await fetch(API_URL); // runs only if clean
 */
export async function assertNotRooted(): Promise<void> {
  const result = await performRootCheck();
  if (result.rooted) {
    // Log reasons for server-side analytics (optional)
    if (!__DEV__) {
      console.error('[Security] Root detected:', result.reasons.join(', '));
    }
    await killApp();
    throw new Error('DEVICE_COMPROMISED'); // Fallback if killApp somehow returns
  }
}