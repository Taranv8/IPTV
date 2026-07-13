// src/native/ApkInstaller.ts
//
// Thin JS wrapper around the custom "ApkInstaller" native Android module.
// downloadApk() replaces RNFS.downloadFile for the APK OTA path — see
// android/ApkInstallerModule.kt for why (react-native-fs has a bug where a
// failed download can crash the whole app instead of rejecting a promise;
// this module never touches react-native-fs at all for APK downloads).
//
// IMPORTANT ANDROID PLATFORM NOTE (unchanged from before):
// Android will NOT let a normal (non-system, non-device-owner) app install an
// APK with zero user interaction. See installApk()'s doc comment in
// ApkInstallerModule.kt for the full explanation.

import { NativeEventEmitter, NativeModules } from 'react-native';

export interface ApkDownloadProgressEvent {
  bytesWritten: number;
  contentLength: number; // -1 if the server didn't send Content-Length
}

interface ApkInstallerNative {
  canRequestPackageInstalls(): Promise<boolean>;
  openUnknownSourcesSettings(): Promise<void>;
  /** Downloads the APK at `url` to `destPath` using a plain native HTTP
   *  connection (no react-native-fs). Progress streams via the
   *  "ApkDownloadProgress" event — subscribe with subscribeToApkDownloadProgress
   *  below before awaiting this, since events can start firing immediately. */
  downloadApk(url: string, destPath: string): Promise<void>;
  installApk(filePath: string): Promise<void>;
  getInstalledVersionCode(): Promise<string>;
}

const LINKING_ERROR =
  '[ApkInstaller] Native module not found. Did you register ApkInstallerPackage ' +
  'in MainApplication and rebuild the app? APK self-update calls will fail until then.';

const NativeApkInstaller = NativeModules.ApkInstaller as ApkInstallerNative | undefined;

function guard<T extends (...args: any[]) => Promise<any>>(fn?: T, name?: string): T {
  if (fn) return fn;
  return (async () => {
    throw new Error(`${LINKING_ERROR} (missing method: ${name})`);
  }) as unknown as T;
}

const ApkInstaller: ApkInstallerNative = {
  canRequestPackageInstalls: guard(NativeApkInstaller?.canRequestPackageInstalls, 'canRequestPackageInstalls'),
  openUnknownSourcesSettings: guard(NativeApkInstaller?.openUnknownSourcesSettings, 'openUnknownSourcesSettings'),
  downloadApk: guard(NativeApkInstaller?.downloadApk, 'downloadApk'),
  installApk: guard(NativeApkInstaller?.installApk, 'installApk'),
  getInstalledVersionCode: guard(NativeApkInstaller?.getInstalledVersionCode, 'getInstalledVersionCode'),
};

if (!NativeApkInstaller) {
  console.warn(LINKING_ERROR);
}

// NativeEventEmitter needs the actual native module object (not the guarded
// wrapper above) — only construct it when the module is really linked.
const apkEventEmitter = NativeApkInstaller
  ? new NativeEventEmitter(NativeModules.ApkInstaller)
  : null;

/**
 * Subscribe to download progress while downloadApk() is in flight.
 * Returns a subscription with .remove() — always remove it in a finally
 * block once the download settles, success or failure.
 */
export function subscribeToApkDownloadProgress(
  listener: (event: ApkDownloadProgressEvent) => void
): { remove: () => void } {
  if (!apkEventEmitter) {
    return { remove: () => {} };
  }
  return apkEventEmitter.addListener('ApkDownloadProgress', listener);
}

export default ApkInstaller;