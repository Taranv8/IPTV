import React, { useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  StatusBar,
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
} from 'react-native';
import { RootNavigator } from './src/navigation/RootNavigator';
import { ChannelProvider } from './src/context/ChannelContext';
import { SettingsProvider } from './src/context/SettingsContext';
import { ErrorBoundary } from './src/components/common/ErrorBoundary';
import { initRemoteConfig } from './src/services/remoteConfigService';
import { performRootCheck, killApp } from './src/services/rootDetectionService';

if (__DEV__ === false) {
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    console.error('[GlobalError]', error?.message, 'fatal:', isFatal);
  });
}

type AppState = 'checking' | 'blocked' | 'loading' | 'ready';

// Human-readable labels for each detection reason returned by the native module.
const REASON_LABELS: Record<string, string> = {
  ROOT_FILES:          'Root binaries or Magisk files found on device',
  ROOT_PACKAGES:       'Root management app detected',
  SU_EXECUTABLE:       'su binary is accessible',
  BUILD_PROPS:         'System build properties indicate modified OS',
  WRITABLE_SYSTEM:     'System partition is writable',
  XPOSED_FRAMEWORK:    'Xposed or Substrate hook framework detected',
  FRIDA_DETECTED:      'Frida dynamic instrumentation detected',
  PROC_MAPS_TAMPERING: 'Suspicious library found in process memory',
  DEBUGGER_ATTACHED:   'Native debugger is attached to the process',
  SIGNATURE_TAMPERED:  'App signing certificate mismatch',
  NATIVE_MODULE_MISSING: 'Security module could not be loaded',
  NATIVE_CHECK_EXCEPTION: 'Security check encountered an unexpected error',
};

function formatReasons(reasons: string[]): string {
  if (!reasons.length) return 'Unknown security anomaly detected.';
  return reasons
    .map(r => REASON_LABELS[r] ?? r)
    .join('\n');
}

export default function App() {
  const [appState, setAppState] = useState<AppState>('checking');
  const detectionReasons = useRef<string[]>([]);

  useEffect(() => {
    if (appState !== 'checking') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [appState]);

  useEffect(() => {
    let mounted = true;

    const bootstrap = async () => {
      try {
        const rootResult = await performRootCheck();
        if (rootResult.rooted) {
          detectionReasons.current = rootResult.reasons ?? [];
          if (!mounted) return;
          setAppState('blocked');
          setTimeout(() => killApp(), 1500);
          return;
        }
      } catch {
        detectionReasons.current = ['NATIVE_CHECK_EXCEPTION'];
        if (!mounted) return;
        setAppState('blocked');
        setTimeout(() => killApp(), 1500);
        return;
      }

      if (!mounted) return;

      setAppState('loading');
      try {
        await initRemoteConfig();
      } catch {
        // initRemoteConfig never throws by contract, but guard anyway
      }

      if (!mounted) return;
      setAppState('ready');
    };

    initRemoteConfig().catch(() => {});
    bootstrap();
    return () => {
      mounted = false;
    };
  }, []);

  if (appState === 'checking' || appState === 'loading') {
    return (
      <View style={styles.loader}>
        <StatusBar barStyle="light-content" backgroundColor="#000" />
        <ActivityIndicator size="large" color="#ffffff" />
      </View>
    );
  }

  if (appState === 'blocked') {
    const reasonText = formatReasons(detectionReasons.current);
    return (
      <View style={styles.blocked}>
        <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" />
        <Text style={styles.blockedTitle}>Access Denied</Text>
        <Text style={styles.blockedSubtitle}>
          This app cannot run on a rooted or tampered device.
        </Text>
        <Text style={styles.blockedReasons}>{reasonText}</Text>
        <Text style={styles.blockedClosing}>The app will now close.</Text>
      </View>
    );
  }

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

const styles = StyleSheet.create({
  loader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000000',
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
});