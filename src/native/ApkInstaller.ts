// src/native/ApkInstaller.ts
//
// Thin JS wrapper around the custom "ApkInstaller" native Android module.
// See /android/ApkInstallerModule.kt, ApkInstallReceiver.kt, ApkInstallerPackage.kt
// for the native implementation, and android/README.md for manifest/gradle setup.
//
// IMPORTANT ANDROID PLATFORM NOTE (read before wiring this up):
// Android will NOT let a normal (non-system, non-device-owner) app install an
// APK with zero user interaction. What this module gets you:
//   • No manual "share the file / open a file manager" step — the app
//     downloads the APK and starts the install itself.
//   • The system's own install-confirmation screen may still appear (this is
//     an OS security boundary, not something any app-level code can bypass
//     unless the app is a pre-installed system app or an Android Enterprise
//     Device Owner). On many TV boxes with USER_ACTION_NOT_REQUIRED support
//     (API 31+, and only when this app was the installer of record for the
//     currently running version) the confirmation screen is skipped — but
//     don't assume that's guaranteed on every device/OEM.
//   • Once installed, ApkInstallReceiver relaunches the app automatically —
//     no user tap needed for that part.
//
// If you control the TV boxes and can provision them as Device Owner via an
// MDM/EMM, fully silent installs (no dialog at all, on every device) become
// possible — that's a separate, larger setup (DevicePolicyManager +
// PackageInstaller with elevated install permission) and isn't included here.

import { NativeModules } from 'react-native';

interface ApkInstallerNative {
  /** Whether this app currently has the "install unknown apps" permission. */
  canRequestPackageInstalls(): Promise<boolean>;
  /** Opens the OS settings screen where the user grants that permission. */
  openUnknownSourcesSettings(): Promise<void>;
  /** Streams the given APK file into a PackageInstaller session and commits it. */
  installApk(filePath: string): Promise<void>;
  /** Returns the currently-installed native versionCode as a string (avoids float precision issues over the bridge). */
  getInstalledVersionCode(): Promise<string>;
}

const LINKING_ERROR =
  '[ApkInstaller] Native module not found. Did you register ApkInstallerPackage ' +
  'in MainApplication and rebuild the app? APK self-update calls will fail until then. ' +
  'See /android/README.md.';

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
  installApk: guard(NativeApkInstaller?.installApk, 'installApk'),
  getInstalledVersionCode: guard(NativeApkInstaller?.getInstalledVersionCode, 'getInstalledVersionCode'),
};

if (!NativeApkInstaller) {
  console.warn(LINKING_ERROR);
}

export default ApkInstaller;