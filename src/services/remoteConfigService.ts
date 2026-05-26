// services/remoteConfigService.ts

import remoteConfig from '@react-native-firebase/remote-config';
import {
  APP_CONFIG,
  ERROR_MESSAGES,
  ERROR_REPORTING,
  _RC_DEFAULTS,
} from '../constants/config';

// How long to use cached Remote Config values before re-fetching.
// Set to 0 during development to always fetch fresh.
const FETCH_INTERVAL_MS = __DEV__ ? 0 : 60 * 60 * 1000; // 1 hour in prod

/**
 * Fetches Firebase Remote Config and merges values into the exported
 * config objects IN PLACE — so all existing imports keep working
 * without any changes at call sites.
 *
 * Falls back silently to hardcoded defaults if Firebase is unreachable.
 */
export async function initRemoteConfig(): Promise<void> {
  try {
    const rc = remoteConfig();

    // 1. Register our hardcoded values as defaults.
    //    If Firebase has no value for a key, the default is used.
    await rc.setDefaults(_RC_DEFAULTS);

    // 2. Set fetch interval.
    await rc.setConfigSettings({
      minimumFetchIntervalMillis: FETCH_INTERVAL_MS,
    });

    // 3. Fetch + activate. Returns true if new values were activated.
    const activated = await rc.fetchAndActivate();
    if (__DEV__) {
      console.log('[RemoteConfig] fetchAndActivate:', activated ? 'new values' : 'cached/default');
    }

    // 4. Merge remote values into exported objects in place.
    //    Object.assign keeps the same reference, so all importers see updates.
    mergeRemoteKey(rc, 'app_config', APP_CONFIG);
    mergeRemoteKey(rc, 'error_messages', ERROR_MESSAGES);
    mergeRemoteKey(rc, 'error_reporting', ERROR_REPORTING);

  } catch (error) {
    // Non-fatal — app continues with hardcoded defaults.
    console.warn('[RemoteConfig] Failed to fetch, using defaults:', error);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mergeRemoteKey(
  rc: ReturnType<typeof remoteConfig>,
  key: string,
  target: Record<string, unknown>,
): void {
  try {
    const raw = rc.getValue(key).asString();
    if (!raw) return;

    const parsed = JSON.parse(raw);

    // Only merge keys that already exist in the target —
    // prevents Firebase from injecting unknown keys.
    for (const field of Object.keys(target)) {
      if (field in parsed) {
        (target as Record<string, unknown>)[field] = parsed[field];
      }
    }
  } catch (e) {
    console.warn(`[RemoteConfig] Failed to parse key "${key}":`, e);
  }
}