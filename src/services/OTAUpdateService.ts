import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import RNRestart from 'react-native-restart';
import firestore from '@react-native-firebase/firestore';

// ─── Constants ────────────────────────────────────────────────────────
const HASH_KEY         = '@ota/current_hash';
const PLATFORM         = Platform.OS; // 'android' only for your TV + phone targets
const OTA_DIR          = `${RNFS.DocumentDirectoryPath}/ota`;
const BUNDLE_FILENAME  = 'index.android.bundle';
const OTA_BUNDLE_PATH  = `${OTA_DIR}/${BUNDLE_FILENAME}`;

// ─── Types ────────────────────────────────────────────────────────────
export interface OTAProgressEvent {
  percent: number;       // 0–100
  bytesWritten: number;  // bytes so far
  contentLength: number; // total bytes
}

export type OTAProgressCallback = (event: OTAProgressEvent) => void;

export interface OTANoUpdate {
  updateAvailable: false;
  error?: Error;
}

export interface OTAUpdateReady {
  updateAvailable: true;
  version: string;
  bundleSize: number; // bytes — stored in Firestore, see upload script change below
  applyUpdate: (onProgress: OTAProgressCallback) => Promise<void>;
}

export type OTAResult = OTANoUpdate | OTAUpdateReady;

// ─── Module-level store (avoids serialising functions through nav params) ──
let _pendingResult: OTAResult | null = null;

export function storePendingOTA(result: OTAResult): void {
  _pendingResult = result;
}

export function consumePendingOTA(): OTAResult | null {
  const r = _pendingResult;
  _pendingResult = null;
  return r;
}

// ─────────────────────────────────────────────────────────────────────
//  checkForOTAUpdate()
//  Call during the Splash screen. Returns a status object.
//  Does NOT download anything — just compares hashes.
// ─────────────────────────────────────────────────────────────────────
export async function checkForOTAUpdate(): Promise<OTAResult> {
  // Skip entirely in dev — Metro bundler handles updates
  if (__DEV__) {
    return { updateAvailable: false };
  }

  try {
   // Replace the .get() call with this:
const fetchWithTimeout = () =>
  Promise.race([
    firestore()
      .collection('ota_updates')
      .doc(PLATFORM)
      .get({ source: 'server' }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Firestore timeout')), 8000)
    ),
  ]);

const doc = await fetchWithTimeout();

    if (!doc.exists) {
      return { updateAvailable: false };
    }

    const cfg = doc.data()!;

    // Remote kill-switch
    if (!cfg.enabled) {
      return { updateAvailable: false };
    }

    const { hash: remoteHash, bundleUrl, version, bundleSize = 0 } = cfg;

    if (!remoteHash || !bundleUrl) {
      console.warn('[OTA] Remote config incomplete — skipping');
      return { updateAvailable: false };
    }

    // Compare with locally stored hash
    const localHash = await AsyncStorage.getItem(HASH_KEY);

    if (localHash === remoteHash) {
      return { updateAvailable: false };
    }

    // Hashes differ → update available
    const result: OTAUpdateReady = {
      updateAvailable: true,
      version,
      bundleSize,
      applyUpdate: (onProgress) =>
        _downloadAndApply(bundleUrl, remoteHash, onProgress),
    };

    // Cache it so OTAUpdateScreen can pick it up without re-fetching
    storePendingOTA(result);
    return result;

  } catch (error) {
    console.error('[OTA] Check failed:', error);
    return { updateAvailable: false, error: error as Error };
  }
}

// ─────────────────────────────────────────────────────────────────────
//  _downloadAndApply()  — internal, called via applyUpdate()
// ─────────────────────────────────────────────────────────────────────
async function _downloadAndApply(
  bundleUrl: string,
  newHash: string,
  onProgress: OTAProgressCallback,
): Promise<void> {

  // Make sure the OTA directory exists
  const dirExists = await RNFS.exists(OTA_DIR);
  if (!dirExists) {
    await RNFS.mkdir(OTA_DIR);
  }

  const tempPath = `${OTA_DIR}/${BUNDLE_FILENAME}.tmp`;

  const download = RNFS.downloadFile({
  fromUrl: bundleUrl,
  toFile: tempPath,
  progressInterval: 250,   // fire every 250ms instead — much smoother
  progress: ({ bytesWritten, contentLength }) => {
    if (contentLength > 0) {
      onProgress({
        percent: Math.round((bytesWritten / contentLength) * 100),
        bytesWritten,
        contentLength,
      });
    }
  },
});

  const { statusCode } = await download.promise;

  if (statusCode !== 200) {
    // Clean up failed temp file
    if (await RNFS.exists(tempPath)) await RNFS.unlink(tempPath);
    throw new Error(`Download failed — HTTP ${statusCode}`);
  }

  // Atomic swap: delete old → rename temp → new
  if (await RNFS.exists(OTA_BUNDLE_PATH)) {
    await RNFS.unlink(OTA_BUNDLE_PATH);
  }
  await RNFS.moveFile(tempPath, OTA_BUNDLE_PATH);

  // Persist the new hash before restart
  await AsyncStorage.setItem(HASH_KEY, newHash);

  console.log('[OTA] Bundle saved. Restarting in 400 ms…');
  setTimeout(() => RNRestart.Restart(), 400);
}

// ─────────────────────────────────────────────────────────────────────
//  clearOTABundle() — emergency recovery / developer menu
// ─────────────────────────────────────────────────────────────────────
export async function clearOTABundle(): Promise<void> {
  try {
    if (await RNFS.exists(OTA_BUNDLE_PATH)) {
      await RNFS.unlink(OTA_BUNDLE_PATH);
    }
    await AsyncStorage.removeItem(HASH_KEY);
    RNRestart.Restart();
  } catch (e) {
    console.error('[OTA] clearOTABundle failed:', e);
  }
}