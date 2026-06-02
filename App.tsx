// App.tsx
//
// Bootstrap order:
//   1. Root / tamper check (existing rootDetectionService)  → blocks if rooted
//   2. MITM / tool detection (new sslPinningService)        → warns + blocks
//   3. Remote Config fetch  (remoteConfigService)           → populates config
//   4. SSL pin setup        (sslPinningService)             → sends RC pins to native
//   5. Render app

import React, { useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  Linking,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ActivityIndicator,
} from 'react-native';
import { RootNavigator } from './src/navigation/RootNavigator';
import { ChannelProvider } from './src/context/ChannelContext';
import { SettingsProvider } from './src/context/SettingsContext';
import { ErrorBoundary } from './src/components/common/ErrorBoundary';
import { initRemoteConfig } from './src/services/remoteConfigService';
import { performRootCheck, killApp } from './src/services/rootDetectionService';
import {
  initSslPinning,
  detectMitmAndTools,
  formatMitmReasons,
  getDetectedAppNames,
  type MitmDetectionResult,
} from './src/services/sslPinningService';

// ─── Global error handler ─────────────────────────────────────────────────────

if (__DEV__ === false) {
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    console.error('[GlobalError]', error?.message, 'fatal:', isFatal);
  });
}

// ─── Types ────────────────────────────────────────────────────────────────────

type AppState = 'checking' | 'blocked' | 'mitm_warning' | 'loading' | 'ready';

interface BlockedInfo {
  title: string;
  subtitle: string;
  reasons: string;
  closing: string;
}

// ─── Root detection labels (unchanged) ───────────────────────────────────────

const ROOT_REASON_LABELS: Record<string, string> = {
  ROOT_FILES:              'Root binaries or Magisk files found on device',
  ROOT_PACKAGES:           'Root management app detected',
  SU_EXECUTABLE:           'su binary is accessible',
  BUILD_PROPS:             'System build properties indicate modified OS',
  WRITABLE_SYSTEM:         'System partition is writable',
  XPOSED_FRAMEWORK:        'Xposed or Substrate hook framework detected',
  FRIDA_DETECTED:          'Frida dynamic instrumentation detected',
  PROC_MAPS_TAMPERING:     'Suspicious library found in process memory',
  DEBUGGER_ATTACHED:       'Native debugger is attached to the process',
  SIGNATURE_TAMPERED:      'App signing certificate mismatch',
  NATIVE_MODULE_MISSING:   'Security module could not be loaded',
  NATIVE_CHECK_EXCEPTION:  'Security check encountered an unexpected error',
};

function formatRootReasons(reasons: string[]): string {
  if (!reasons.length) return 'Unknown security anomaly detected.';
  return reasons.map(r => ROOT_REASON_LABELS[r] ?? r).join('\n');
}

// ─── MITM blocked screen helpers ─────────────────────────────────────────────

function buildMitmBlockedInfo(result: MitmDetectionResult): BlockedInfo {
  const appNames = getDetectedAppNames(result.packages);
  const appList  = appNames.length > 0 ? appNames.join(', ') : '';

  const subtitle = appList
    ? `The following network interception app${appNames.length > 1 ? 's were' : ' was'} ` +
      `detected on your device:\n\n${appList}\n\nPlease uninstall ${appNames.length > 1 ? 'them' : 'it'} ` +
      `and relaunch the app.`
    : 'A network interception or instrumentation tool was detected on your device. ' +
      'Please remove it and relaunch the app.';

  return {
    title:    'Security Risk Detected',
    subtitle,
    reasons:  formatMitmReasons(result.reasons),
    closing:  'The app will close for your security.',
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function App() {
  const [appState, setAppState]       = useState<AppState>('checking');
  const [blockedInfo, setBlockedInfo] = useState<BlockedInfo | null>(null);

  // Disable hardware back while on block/warning screens
  useEffect(() => {
    if (appState === 'checking' || appState === 'blocked' || appState === 'mitm_warning') {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
      return () => sub.remove();
    }
  }, [appState]);

  // ── Main bootstrap ──────────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;

    const bootstrap = async () => {

      // ── Step 1: Root / tamper check ─────────────────────────────────────
      try {
        const rootResult = await performRootCheck();
        if (rootResult.rooted) {
          if (!mounted) return;
          setBlockedInfo({
            title:    'Access Denied',
            subtitle: 'This app cannot run on a rooted or tampered device.',
            reasons:  formatRootReasons(rootResult.reasons ?? []),
            closing:  'The app will now close.',
          });
          setAppState('blocked');
          setTimeout(() => killApp(), 1500);
          return;
        }
      } catch {
        if (!mounted) return;
        setBlockedInfo({
          title:    'Access Denied',
          subtitle: 'A security check failed.',
          reasons:  'Security check encountered an unexpected error.',
          closing:  'The app will now close.',
        });
        setAppState('blocked');
        setTimeout(() => killApp(), 1500);
        return;
      }

      // ── Step 2: MITM / instrumentation-tool detection ───────────────────
      try {
        const mitmResult = await detectMitmAndTools();
        if (mitmResult.detected) {
          if (!mounted) return;
          setBlockedInfo(buildMitmBlockedInfo(mitmResult));
          setAppState('mitm_warning');
          // Give the user time to read the message before killing
          setTimeout(() => killApp(), 6000);
          return;
        }
      } catch {
        // Detection error is non-fatal; log and continue
        console.warn('[App] MITM detection error — continuing');
      }

      // ── Step 3: Remote Config fetch ─────────────────────────────────────
      if (!mounted) return;
      setAppState('loading');

      try {
        await initRemoteConfig();
      } catch {
        // initRemoteConfig is contractually non-throwing; guarded anyway
      }

      // ── Step 4: SSL pinning setup ───────────────────────────────────────
      try {
        const pinResult = await initSslPinning();
        if (!pinResult.success) {
          // Pin mismatch / RC delivery failure is non-fatal in this implementation.
          // Promote to fatal if your threat model requires it:
          //   setAppState('blocked'); setTimeout(killApp, 1500); return;
          console.warn('[App] SSL pinning setup failed:', pinResult.error);
        }
      } catch {
        console.warn('[App] SSL pinning threw unexpectedly');
      }

      // ── Ready ───────────────────────────────────────────────────────────
      if (!mounted) return;
      setAppState('ready');
    };

    bootstrap();
    return () => { mounted = false; };
  }, []);

  // ── Render: loading ─────────────────────────────────────────────────────────
  if (appState === 'checking' || appState === 'loading') {
    return (
      <View style={styles.loader}>
        <StatusBar barStyle="light-content" backgroundColor="#000" />
        <ActivityIndicator size="large" color="#ffffff" />
        <Text style={styles.loaderText}>
          {appState === 'checking' ? 'Checking device security…' : 'Loading…'}
        </Text>
      </View>
    );
  }

  // ── Render: blocked (root / fatal error) ────────────────────────────────────
  if (appState === 'blocked' && blockedInfo) {
    return (
      <View style={styles.blocked}>
        <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" />
        <Text style={styles.blockedTitle}>{blockedInfo.title}</Text>
        <Text style={styles.blockedSubtitle}>{blockedInfo.subtitle}</Text>
        <Text style={styles.blockedReasons}>{blockedInfo.reasons}</Text>
        <Text style={styles.blockedClosing}>{blockedInfo.closing}</Text>
      </View>
    );
  }

  // ── Render: MITM warning (with app list + uninstall deep-link) ──────────────
  if (appState === 'mitm_warning' && blockedInfo) {
    return (
      <View style={styles.mitmWarning}>
        <StatusBar barStyle="light-content" backgroundColor="#0d0d0d" />
        <Text style={styles.mitmIcon}>🔒</Text>
        <Text style={styles.mitmTitle}>{blockedInfo.title}</Text>
        <ScrollView
          contentContainerStyle={styles.mitmScroll}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.mitmSubtitle}>{blockedInfo.subtitle}</Text>
          <View style={styles.mitmReasonsBox}>
            <Text style={styles.mitmReasonsLabel}>Detection details</Text>
            <Text style={styles.mitmReasons}>{blockedInfo.reasons}</Text>
          </View>

          {/* Deep-link to Android app settings for easy uninstall */}
          <TouchableOpacity
            style={styles.mitmButton}
            onPress={() => Linking.openURL('market://search?q=http+canary+proxy')}
            accessibilityRole="button"
          >
            <Text style={styles.mitmButtonText}>Open App Settings to Uninstall</Text>
          </TouchableOpacity>

          <Text style={styles.mitmClosing}>{blockedInfo.closing}</Text>
        </ScrollView>
      </View>
    );
  }

  // ── Render: ready ────────────────────────────────────────────────────────────
  return (
    <ErrorBoundary>
      <SettingsProvider>
        <ChannelProvider>
          <StatusBar barStyle="light-content" />
          <RootNavigator />
        </ChannelProvider>
      </SettingsProvider>
    </ErrorBoundary>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Loading
  loader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000000',
    gap: 16,
  },
  loaderText: {
    color: '#888',
    fontSize: 13,
  },

  // Generic block screen
  blocked: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0a0a0a',
    padding: 32,
  },
  blockedTitle: {
    color: '#e53935',
    fontSize: 22,
    fontWeight: '600',
    marginBottom: 12,
    textAlign: 'center',
  },
  blockedSubtitle: {
    color: '#aaaaaa',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  blockedReasons: {
    marginTop: 24,
    color: '#888888',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 20,
    fontFamily: 'monospace',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 6,
    padding: 12,
  },
  blockedClosing: {
    marginTop: 20,
    color: '#e53935',
    fontSize: 14,
    textAlign: 'center',
    fontWeight: '500',
  },

  // MITM warning screen
  mitmWarning: {
    flex: 1,
    backgroundColor: '#0d0d0d',
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 28,
  },
  mitmIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  mitmTitle: {
    color: '#ffb300',
    fontSize: 21,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  mitmScroll: {
    alignItems: 'center',
    paddingBottom: 40,
  },
  mitmSubtitle: {
    color: '#cccccc',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  mitmReasonsBox: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 8,
    padding: 14,
    marginBottom: 24,
    backgroundColor: '#141414',
  },
  mitmReasonsLabel: {
    color: '#555',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  mitmReasons: {
    color: '#888',
    fontSize: 12,
    lineHeight: 20,
    fontFamily: 'monospace',
  },
  mitmButton: {
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#ffb300',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
    marginBottom: 20,
  },
  mitmButtonText: {
    color: '#ffb300',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  mitmClosing: {
    color: '#e53935',
    fontSize: 13,
    textAlign: 'center',
    fontWeight: '500',
  },
});
