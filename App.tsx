// App.tsx
//
// Bootstrap order:
//   1. Root / tamper check (existing rootDetectionService)  → blocks if rooted
//   2. MITM / tool detection (new sslPinningService)        → warns + blocks
//   3. Remote Config fetch  (remoteConfigService)           → populates config
//   4. SSL pin setup        (sslPinningService)             → sends RC pins to native
//   5. Render app

import React, { useEffect, useState } from 'react';
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
  AppState as RNAppState,
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
  startPinWatch,
  stopPinWatch,
  onMitmKill,
  formatMitmReasons,
  getDetectedAppNames,
  MitmDetectionResult,
} from './src/services/sslPinningService';

// ─── Global error handler ─────────────────────────────────────────────────────

if (__DEV__ === false) {
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    console.error('[GlobalError]', error?.message, 'fatal:', isFatal);
  });
}

// ─── Types ────────────────────────────────────────────────────────────────────

type AppStatus = 'checking' | 'blocked' | 'mitm_warning' | 'loading' | 'ready';

interface BlockedInfo {
  title: string;
  subtitle: string;
  reasons: string;
  closing: string;
}

// ─── Root detection labels ────────────────────────────────────────────────────

const ROOT_REASON_LABELS: Record<string, string> = {
  ROOT_FILES:             'Root binaries or Magisk files found on device',
  ROOT_PACKAGES:          'Root management app detected',
  SU_EXECUTABLE:          'su binary is accessible',
  BUILD_PROPS:            'System build properties indicate modified OS',
  WRITABLE_SYSTEM:        'System partition is writable',
  XPOSED_FRAMEWORK:       'Xposed or Substrate hook framework detected',
  FRIDA_DETECTED:         'Frida dynamic instrumentation detected',
  PROC_MAPS_TAMPERING:    'Suspicious library found in process memory',
  DEBUGGER_ATTACHED:      'Native debugger is attached to the process',
  SIGNATURE_TAMPERED:     'App signing certificate mismatch',
  NATIVE_MODULE_MISSING:  'Security module could not be loaded',
  NATIVE_CHECK_EXCEPTION: 'Security check encountered an unexpected error',
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
    title:   'Security Risk Detected',
    subtitle,
    reasons: formatMitmReasons(result.reasons),
    closing: 'The app will close for your security.',
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function App() {
  const [appStatus, setAppStatus]     = useState<AppStatus>('checking');
  const [blockedInfo, setBlockedInfo] = useState<BlockedInfo | null>(null);

  // Disable hardware back while on block/warning screens
  useEffect(() => {
    if (
      appStatus === 'checking' ||
      appStatus === 'blocked'  ||
      appStatus === 'mitm_warning'
    ) {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
      return () => sub.remove();
    }
  }, [appStatus]);

  // ── Main bootstrap ──────────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;

    // ── FIX: declared here so the cleanup return below can always reach it ──
    let appStateSub: ReturnType<typeof RNAppState.addEventListener> | null = null;

    // Register the MITM kill handler immediately — before any async work —
    // so it fires even if a kill event arrives during bootstrap.
    const unsubMitm = onMitmKill((reason: string) => {
      console.warn('[Security] MITM kill:', reason);
      // Clear your stream URLs, auth tokens, Redux state, etc. here.
    });

    const bootstrap = async () => {

      // ── Step 1: Root / tamper check ───────────────────────────────────────
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
          setAppStatus('blocked');
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
        setAppStatus('blocked');
        setTimeout(() => killApp(), 1500);
        return;
      }

      // ── Step 2: MITM / instrumentation-tool detection ─────────────────────
      try {
        const mitmResult = await detectMitmAndTools();
        if (mitmResult.detected) {
          if (!mounted) return;
          setBlockedInfo(buildMitmBlockedInfo(mitmResult));
          setAppStatus('mitm_warning');
          setTimeout(() => killApp(), 6000);
          return;
        }
      } catch {
        console.warn('[App] MITM detection error — continuing');
      }

      // ── Step 3: Remote Config fetch ───────────────────────────────────────
      if (!mounted) return;
      setAppStatus('loading');

      try {
        await initRemoteConfig();
      } catch {
        // initRemoteConfig is contractually non-throwing; guarded anyway
      }

      // ── Step 4: SSL pinning setup ─────────────────────────────────────────
      try {
        const pinResult = await initSslPinning();
        if (!pinResult.success) {
          if (__DEV__) {
            console.warn('[App] SSL pinning setup failed:', pinResult.error);
          } else {
            if (!mounted) return;
            setBlockedInfo({
              title:    'Connection Security Error',
              subtitle: 'A secure connection to our servers could not be verified. ' +
                        'This may indicate a network interception attempt.',
              reasons:  pinResult.error ?? 'Certificate pin mismatch',
              closing:  'The app will now close.',
            });
            setAppStatus('blocked');
            setTimeout(() => killApp(), 2000);
            return;
          }
        }
      } catch {
        console.warn('[App] SSL pinning threw unexpectedly');
      }

      // ── Step 5: Start WebSocket pin-watch ─────────────────────────────────
      // openSocket() fires immediately — TLS handshake + pin check happen now.
      // appStateSub is declared above so the cleanup return can remove it.
      if (!mounted) return;
      startPinWatch();

      appStateSub = RNAppState.addEventListener('change', (state) => {
        if (state === 'active') startPinWatch();
        else                    stopPinWatch();
      });

      setAppStatus('ready');
    };

    bootstrap();

    // ── Cleanup: runs when the component unmounts ─────────────────────────────
    // appStateSub is reachable here because it was declared in this scope,
    // not inside the async bootstrap function.
    return () => {
      mounted = false;
      unsubMitm();
      stopPinWatch();
      appStateSub?.remove();
    };
  }, []);

  // ── Continuous MITM poll while app is running ─────────────────────────────
  useEffect(() => {
    if (appStatus !== 'ready') return;

    let pollActive = true;

    const poll = async () => {
      while (pollActive) {
        await new Promise<void>(resolve => setTimeout(resolve, 4000));
        if (!pollActive) break;
        try {
          const mitmResult = await detectMitmAndTools();
          if (mitmResult.detected) {
            setBlockedInfo(buildMitmBlockedInfo(mitmResult));
            setAppStatus('mitm_warning');
            setTimeout(() => killApp(), 3000);
            pollActive = false;
          }
        } catch {
          // non-fatal
        }
      }
    };

    poll();
    return () => { pollActive = false; };
  }, [appStatus]);

  // ── Render: loading ───────────────────────────────────────────────────────
  if (appStatus === 'checking' || appStatus === 'loading') {
    return (
      <View style={styles.loader}>
        <StatusBar barStyle="light-content" backgroundColor="#000" />
        <ActivityIndicator size="large" color="#ffffff" />
        <Text style={styles.loaderText}>
          {appStatus === 'checking' ? 'Checking device security…' : 'Loading…'}
        </Text>
      </View>
    );
  }

  // ── Render: blocked (root / fatal error) ──────────────────────────────────
  if (appStatus === 'blocked' && blockedInfo) {
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

  // ── Render: MITM warning ──────────────────────────────────────────────────
  if (appStatus === 'mitm_warning' && blockedInfo) {
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

  // ── Render: ready ─────────────────────────────────────────────────────────
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