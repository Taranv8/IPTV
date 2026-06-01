// App.tsx

import React, { useEffect, useState } from 'react';
import { StatusBar, View, ActivityIndicator, StyleSheet, BackHandler } from 'react-native';
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

export default function App() {
  const [appState, setAppState] = useState<AppState>('checking');

  useEffect(() => {
    let mounted = true;

    const bootstrap = async () => {
      // ─── Step 1: Root / tamper check (MUST run before anything else) ────────
      try {
        const rootResult = await performRootCheck();
        if (rootResult.rooted) {
          // Silently kill — don't show error UI that hints at detection
          await killApp();
          return; // killApp() terminates the process; this is a safety net
        }
      } catch {
        // Any exception in the security check → fail-secure and kill
        await killApp();
        return;
      }

      if (!mounted) return;

      // ─── Step 2: Remote config (safe — device is clean) ─────────────────────
      setAppState('loading');
      try {
        await initRemoteConfig();
      } catch {
        // initRemoteConfig never throws by contract, but guard anyway
      }

      if (!mounted) return;
      setAppState('ready');
    };

    bootstrap();

    return () => {
      mounted = false;
    };
  }, []);

  // Prevent back-button while security check is running
  useEffect(() => {
    if (appState === 'checking') {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
      return () => sub.remove();
    }
  }, [appState]);

  if (appState === 'checking' || appState === 'loading') {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color="#ffffff" />
      </View>
    );
  }

  if (appState === 'blocked') {
    // Should never reach here (killApp terminates the process),
    // but renders a blank screen as a final fallback.
    return <View style={styles.loader} />;
  }

  return (
    <ErrorBoundary>
      <SettingsProvider>
        <ChannelProvider>
          <StatusBar barStyle="light-content" backgroundColor="#000000" />
          <RootNavigator />
        </ChannelProvider>
      </SettingsProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  loader: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
  },
});