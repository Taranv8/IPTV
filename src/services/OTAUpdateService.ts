// services/OTAUpdateService.ts
import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import RNRestart from 'react-native-restart';
import firestore from '@react-native-firebase/firestore';
import ApkInstaller, { subscribeToApkDownloadProgress } from '../native/ApkInstaller';

// ─── Constants ────────────────────────────────────────────────────────
const HASH_KEY         = '@ota/current_hash';
const PLATFORM         = Platform.OS; // 'android' only for your TV + phone targets
const OTA_DIR          = `${RNFS.DocumentDirectoryPath}/ota`;
const BUNDLE_FILENAME  = 'index.android.bundle';
const OTA_BUNDLE_PATH  = `${OTA_DIR}/${BUNDLE_FILENAME}`;
const APK_FILENAME     = 'update.apk';
const OTA_APK_PATH     = `${OTA_DIR}/${APK_FILENAME}`;

// ─── Firestore doc shape (ota_updates/{platform}) ──────────────────────
// (unchanged — see previous version's comments for the full field list)

// ─── Types ────────────────────────────────────────────────────────────
export interface OTAProgressEvent {
  percent: number;       // 0–100
  bytesWritten: number;  // bytes so far
  contentLength: number; // total bytes
}

export type OTAProgressCallback = (event: OTAProgressEvent) => void;

export type OTAUpdateKind = 'bundle' | 'apk';

export interface OTANoUpdate {
  updateAvailable: false;
  error?: Error;
}

interface OTAReadyBase {
  updateAvailable: true;
  version: string;
  forceUpdate: boolean;
}

export interface OTABundleUpdateReady extends OTAReadyBase {
  updateType: 'bundle';
  bundleSize: number;
  applyUpdate: (onProgress: OTAProgressCallback) => Promise<void>;
}

export interface OTAApkUpdateReady extends OTAReadyBase {
  updateType: 'apk';
  apkSize: number;
  applyUpdate: (onProgress: OTAProgressCallback) => Promise<void>;
}

export type OTAUpdateReady = OTABundleUpdateReady | OTAApkUpdateReady;

export type OTAResult = OTANoUpdate | OTAUpdateReady;

// ─── Module-level store ─────────────────────────────────────────────────
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
// ─────────────────────────────────────────────────────────────────────
export async function checkForOTAUpdate(): Promise<OTAResult> {
  if (__DEV__) {
    return { updateAvailable: false };
  }

  try {
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

    if (!cfg.enabled) {
      return { updateAvailable: false };
    }

    const forceUpdate: boolean = cfg.forceUpdate === true;
    const updateType: OTAUpdateKind = cfg.updateType === 'apk' ? 'apk' : 'bundle';

    if (updateType === 'apk') {
      return await _checkApkUpdate(cfg, forceUpdate);
    }
    return await _checkBundleUpdate(cfg, forceUpdate);

  } catch (error) {
    console.error('[OTA] Check failed:', error);
    return { updateAvailable: false, error: error as Error };
  }
}

// ─────────────────────────────────────────────────────────────────────
//  Bundle update check — unchanged
// ─────────────────────────────────────────────────────────────────────
async function _checkBundleUpdate(
  cfg: Record<string, any>,
  forceUpdate: boolean,
): Promise<OTAResult> {
  const { hash: remoteHash, bundleUrl, version, bundleSize = 0 } = cfg;

  if (!remoteHash || !bundleUrl) {
    console.warn('[OTA] Remote bundle config incomplete — skipping');
    return { updateAvailable: false };
  }

  const localHash = await AsyncStorage.getItem(HASH_KEY);
  if (localHash === remoteHash) {
    return { updateAvailable: false };
  }

  const result: OTABundleUpdateReady = {
    updateAvailable: true,
    updateType: 'bundle',
    version,
    bundleSize,
    forceUpdate,
    applyUpdate: (onProgress) => _downloadAndApplyBundle(bundleUrl, remoteHash, onProgress),
  };

  storePendingOTA(result);
  return result;
}

// ─────────────────────────────────────────────────────────────────────
//  APK update check — unchanged
// ─────────────────────────────────────────────────────────────────────
async function _checkApkUpdate(
  cfg: Record<string, any>,
  forceUpdate: boolean,
): Promise<OTAResult> {
  const { apkUrl, apkVersionCode, apkVersionName, apkSize = 0 } = cfg;

  if (!apkUrl || !apkVersionCode) {
    console.warn('[OTA] Remote APK config incomplete — skipping');
    return { updateAvailable: false };
  }

  let installedVersionCode = 0;
  try {
    installedVersionCode = parseInt(await ApkInstaller.getInstalledVersionCode(), 10);
  } catch (e) {
    console.warn('[OTA] Could not read installed versionCode — skipping APK check:', e);
    return { updateAvailable: false };
  }

  const remoteVersionCode = Number(apkVersionCode);
  if (!Number.isFinite(remoteVersionCode) || installedVersionCode >= remoteVersionCode) {
    return { updateAvailable: false };
  }

  const result: OTAApkUpdateReady = {
    updateAvailable: true,
    updateType: 'apk',
    version: apkVersionName ? String(apkVersionName) : String(remoteVersionCode),
    apkSize,
    forceUpdate,
    applyUpdate: (onProgress) => _downloadAndApplyApk(apkUrl, onProgress),
  };

  storePendingOTA(result);
  return result;
}

// ─────────────────────────────────────────────────────────────────────
//  _downloadAndApplyBundle() — unchanged, still uses RNFS.downloadFile.
//  (Same underlying react-native-fs bug technically still applies here —
//  see android/README notes if you want to carry the native-download fix
//  over to the bundle path too. Left as-is for now since that's not what
//  crashed.)
// ─────────────────────────────────────────────────────────────────────
async function _downloadAndApplyBundle(
  bundleUrl: string,
  newHash: string,
  onProgress: OTAProgressCallback,
): Promise<void> {

  const dirExists = await RNFS.exists(OTA_DIR);
  if (!dirExists) {
    await RNFS.mkdir(OTA_DIR);
  }

  const tempPath = `${OTA_DIR}/${BUNDLE_FILENAME}.tmp`;

  const download = RNFS.downloadFile({
    fromUrl: bundleUrl,
    toFile: tempPath,
    progressInterval: 250,
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
    if (await RNFS.exists(tempPath)) await RNFS.unlink(tempPath);
    throw new Error(`Download failed — HTTP ${statusCode}`);
  }

  if (await RNFS.exists(OTA_BUNDLE_PATH)) {
    await RNFS.unlink(OTA_BUNDLE_PATH);
  }
  await RNFS.moveFile(tempPath, OTA_BUNDLE_PATH);

  await AsyncStorage.setItem(HASH_KEY, newHash);

  console.log('[OTA] Bundle saved. Restarting in 400 ms…');
  setTimeout(() => RNRestart.Restart(), 400);
}

// ─────────────────────────────────────────────────────────────────────
//  _downloadAndApplyApk()  — UPDATED
//
//  No longer touches RNFS at all. Download goes through the native
//  ApkInstaller.downloadApk() (plain HttpURLConnection, written in our own
//  Kotlin code — see android/ApkInstallerModule.kt), which always rejects
//  with a real string error code, so a failed download now correctly
//  surfaces as a rejected promise instead of crashing the app.
// ─────────────────────────────────────────────────────────────────────
async function _downloadAndApplyApk(
  apkUrl: string,
  onProgress: OTAProgressCallback,
): Promise<void> {

  const canInstall = await ApkInstaller.canRequestPackageInstalls();
  if (!canInstall) {
    throw new Error(
      'Install permission not granted. Enable "Allow from this source" in settings and try again.'
    );
  }

  const sub = subscribeToApkDownloadProgress(({ bytesWritten, contentLength }) => {
    if (contentLength > 0) {
      onProgress({
        percent: Math.round((bytesWritten / contentLength) * 100),
        bytesWritten,
        contentLength,
      });
    }
  });

  try {
    await ApkInstaller.downloadApk(apkUrl, OTA_APK_PATH);
  } finally {
    sub.remove();
  }

  console.log('[OTA] APK downloaded. Handing off to PackageInstaller…');
  await ApkInstaller.installApk(OTA_APK_PATH);
}

// ─────────────────────────────────────────────────────────────────────
//  clearOTABundle() — unchanged
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