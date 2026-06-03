// services/remoteConfigService.ts
//
// Changes from original:
//   • Added 'ssl_pins' default to _RC_DEFAULTS (empty array → pinning inactive)
//   • ssl_pins is intentionally NOT merged into any config object —
//     it is read directly by sslPinningService.ts via rc.getValue('ssl_pins')
//   • Everything else is identical to the original.

import remoteConfig from '@react-native-firebase/remote-config';
import {
  APP_CONFIG,
  ERROR_MESSAGES,
  ERROR_REPORTING,
  _RC_DEFAULTS,
} from '../constants/config';

const FETCH_INTERVAL_MS = __DEV__ ? 0 : 60 * 60 * 1000; // 1 hour in prod

/**
 * Fetches Firebase Remote Config and merges values into the exported
 * config objects IN PLACE.
 *
 * ssl_pins — a JSON array of SHA-256 SPKI hashes, e.g.:
 *   ["sha256/AAAA…==", "sha256/BBBB…=="]
 * — is stored in RC but deliberately kept out of the JS config objects.
 * sslPinningService.ts reads it directly from the RC instance.
 */
export async function initRemoteConfig(): Promise<void> {
  try {
    const rc = remoteConfig();

    // 1. Defaults — ssl_pins defaults to "[]" so pinning is inactive
    //    if RC is unreachable on first launch.
  await rc.setDefaults({
  ..._RC_DEFAULTS,
  ssl_pins: '[]',
});

    // 2. Fetch interval
    await rc.setConfigSettings({
      minimumFetchIntervalMillis: FETCH_INTERVAL_MS,
    });

    // 3. Fetch + activate
    const activated = await rc.fetchAndActivate();
    if (__DEV__) {
      console.log(
        '[RemoteConfig] fetchAndActivate:',
        activated ? 'new values' : 'cached/default',
      );
    }

    // 4. Merge standard app config keys
    mergeRemoteKey(rc, 'app_config',     APP_CONFIG);
    mergeRemoteKey(rc, 'error_messages', ERROR_MESSAGES);
    mergeRemoteKey(rc, 'error_reporting', ERROR_REPORTING);

    // NOTE: ssl_pins is NOT merged here.
    // sslPinningService reads it via:
    //   remoteConfig().getValue('ssl_pins').asString()

  } catch (error) {
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
    for (const field of Object.keys(target)) {
      if (field in parsed) {
        (target as Record<string, unknown>)[field] = parsed[field];
      }
    }
  } catch (e) {
    console.warn(`[RemoteConfig] Failed to parse key "${key}":`, e);
  }
}
