// src/services/rootDetectionService.ts
//
// Thin orchestration wrapper around the Kotlin native root detection module.
// JS-side soft checks have been removed — the native module (Layer 1–10) is
// the authoritative source of truth.

import { NativeModules, Platform } from 'react-native';

const { RootDetection } = NativeModules;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RootCheckResult {
  rooted: boolean;
  reasons: string[];
  source: 'native';
}

// ─── Native module guard ──────────────────────────────────────────────────────

async function runNativeChecks(): Promise<RootCheckResult> {
  if (Platform.OS !== 'android') {
    // iOS root detection is a separate concern; allow for now.
    return { rooted: false, reasons: [], source: 'native' };
  }

  if (!RootDetection) {
    if (__DEV__) {
      console.warn('[RootDetection] Native module not found. Skipping in dev mode.');
      return { rooted: false, reasons: [], source: 'native' };
    }
    // Production: module must be present.
    return { rooted: true, reasons: ['NATIVE_MODULE_MISSING'], source: 'native' };
  }

  try {
    const result = await RootDetection.isRooted();
    return {
      rooted: result.rooted === true,
      reasons: Array.isArray(result.reasons) ? result.reasons : [],
      source: 'native',
    };
  } catch (e: any) {
    // Any native exception → fail-secure.
    return { rooted: true, reasons: ['NATIVE_CHECK_EXCEPTION'], source: 'native' };
  }
}

// ─── Kill switch ──────────────────────────────────────────────────────────────

export async function killApp(): Promise<void> {
  try {
    if (RootDetection?.killApp) {
      await RootDetection.killApp();
    }
  } catch {
    // Last resort — native module will handle process termination.
  }
}

// ─── Cache ────────────────────────────────────────────────────────────────────

let _cached: RootCheckResult | null = null;
let _checkPromise: Promise<RootCheckResult> | null = null;

/**
 * Runs native root / tamper checks. Results are cached for the session so
 * every API call guard doesn't repeat the full scan.
 *
 * @param force  Set true to bypass the cache (e.g. for periodic re-checks).
 */
export async function performRootCheck(force = false): Promise<RootCheckResult> {
  if (!force && _cached) return _cached;

  // Deduplicate concurrent callers.
  if (_checkPromise) return _checkPromise;

  _checkPromise = runNativeChecks().then(result => {
    _cached = result;
    _checkPromise = null;
    return result;
  }).catch(err => {
    _checkPromise = null;
    const fallback: RootCheckResult = {
      rooted: true,
      reasons: ['NATIVE_CHECK_EXCEPTION'],
      source: 'native',
    };
    _cached = fallback;
    return fallback;
  });

  return _checkPromise;
}

/**
 * Convenience guard — call this at the top of any API/Firebase function.
 * Kills the app if the device is rooted/tampered.
 *
 * Usage:
 *   await assertNotRooted();
 *   const data = await fetch(API_URL); // runs only if clean
 */
export async function assertNotRooted(): Promise<void> {
  const result = await performRootCheck();
  if (result.rooted) {
    if (!__DEV__) {
      console.error('[Security] Root detected:', result.reasons.join(', '));
    }
    await killApp();
    throw new Error('DEVICE_COMPROMISED'); // Fallback if killApp somehow returns.
  }
}