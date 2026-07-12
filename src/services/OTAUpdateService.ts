// services/OTAUpdateService.ts
import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import RNRestart from 'react-native-restart';
import firestore from '@react-native-firebase/firestore';
import ApkInstaller from '../native/ApkInstaller';

// ─── Constants ────────────────────────────────────────────────────────
const HASH_KEY         = '@ota/current_hash';
const PLATFORM         = Platform.OS; // 'android' only for your TV + phone targets
const OTA_DIR          = `${RNFS.DocumentDirectoryPath}/ota`;
const BUNDLE_FILENAME  = 'index.android.bundle';
const OTA_BUNDLE_PATH  = `${OTA_DIR}/${BUNDLE_FILENAME}`;
const APK_FILENAME     = 'update.apk';
const OTA_APK_PATH     = `${OTA_DIR}/${APK_FILENAME}`;

// ─── Firestore doc shape (ota_updates/{platform}) ──────────────────────
//
// Shared / control fields:
//   enabled:      boolean            — remote kill-switch, unchanged
//   updateType:   'bundle' | 'apk'   — NEW. Defaults to 'bundle' if absent,
//                                      so existing docs keep working with no
//                                      changes. Set to 'apk' whenever you've
//                                      shipped native-code changes that a JS
//                                      bundle swap can't cover.
//   forceUpdate:  boolean            — NEW. Defaults to false if absent.
//                                      false = user can skip/dismiss the
//                                      update screen. true = the update
//                                      screen can't be skipped or backed out
//                                      of (see OTAUpdateScreen.tsx).
//
// Bundle-update fields (used when updateType === 'bundle', same as before):
//   hash, bundleUrl, version, bundleSize
//
// APK-update fields (used when updateType === 'apk'):
//   apkUrl:          string  — direct download URL for the .apk
//   apkVersionCode:  number  — must match android { defaultConfig { versionCode } }
//                              of the release you're pointing to. Compared
//                              against the versionCode currently installed
//                              on-device; update is offered only if greater.
//   apkVersionName:  string  — display string, e.g. "2.4.0" (optional, falls
//                              back to apkVersionCode if omitted)
//   apkSize:         number  — bytes, optional, shown in the UI

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
  bundleSize: number; // bytes — stored in Firestore, see upload script change below
  applyUpdate: (onProgress: OTAProgressCallback) => Promise<void>;
}

export interface OTAApkUpdateReady extends OTAReadyBase {
  updateType: 'apk';
  apkSize: number; // bytes
  applyUpdate: (onProgress: OTAProgressCallback) => Promise<void>;
}

export type OTAUpdateReady = OTABundleUpdateReady | OTAApkUpdateReady;

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
//  Does NOT download anything — just compares hashes / version codes.
// ─────────────────────────────────────────────────────────────────────
export async function checkForOTAUpdate(): Promise<OTAResult> {
  // Skip entirely in dev — Metro bundler handles updates, and there's no
  // native release build to self-update against anyway.
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

    // Remote kill-switch
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
//  Bundle update check (unchanged logic, factored out)
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
//  APK update check (NEW)
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
//  _downloadAndApplyBundle()  — internal, called via applyUpdate()
// ─────────────────────────────────────────────────────────────────────
async function _downloadAndApplyBundle(
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
//  _downloadAndApplyApk()  — internal, called via applyUpdate()  (NEW)
//
//  Assumes the caller (OTAUpdateScreen) has already made sure the
//  "install unknown apps" permission is granted — see waitForInstallPermission
//  in OTAUpdateScreen.tsx — but re-checks defensively since this function
//  can also be called directly by other callers.
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

  const dirExists = await RNFS.exists(OTA_DIR);
  if (!dirExists) {
    await RNFS.mkdir(OTA_DIR);
  }

  if (await RNFS.exists(OTA_APK_PATH)) {
    await RNFS.unlink(OTA_APK_PATH);
  }

  const download = RNFS.downloadFile({
    fromUrl: apkUrl,
    toFile: OTA_APK_PATH,
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
    if (await RNFS.exists(OTA_APK_PATH)) await RNFS.unlink(OTA_APK_PATH);
    throw new Error(`APK download failed — HTTP ${statusCode}`);
  }

  console.log('[OTA] APK downloaded. Handing off to PackageInstaller…');
  // This resolves once the install *session* is committed — the actual
  // install + auto-relaunch happens afterwards via ApkInstallReceiver on
  // the native side (see android/ApkInstallReceiver.kt), possibly after
  // the OS shows its own confirmation screen.
  await ApkInstaller.installApk(OTA_APK_PATH);
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