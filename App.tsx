import React from 'react';
import { StatusBar } from 'react-native';
import { RootNavigator } from './src/navigation/RootNavigator';
import { ChannelProvider } from './src/context/ChannelContext';
import { SettingsProvider } from './src/context/SettingsContext';
import { ErrorBoundary } from './src/components/common/ErrorBoundary';


// ← ADD THIS BLOCK (runs once when JS bundle loads)
if (__DEV__ === false) {
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    console.error('[GlobalError]', error?.message, 'fatal:', isFatal);
    // isFatal = true means the app would crash — add crash reporting here later
  });
}

export default function App() {
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