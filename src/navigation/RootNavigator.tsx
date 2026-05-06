import React, { useEffect } from 'react';
import { Platform, BackHandler } from 'react-native';
import {
  NavigationContainer,
  useNavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { RootStackParamList } from '../types/navigation';
import SplashScreen from '../screens/splash/SplashScreen';
import OTAUpdateScreen from '../screens/ota/OTAUpdateScreen';
import SelectionScreen from '../screens/selection/SelectionScreen';
import SimpleUIScreen from '../screens/simple/SimpleUIScreen';
import AdvancedUIScreen from '../screens/advanced/AdvancedUIScreen';
import SettingsScreen from '../screens/settings/SettingsScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

export const RootNavigator = () => {
  const navigationRef = useNavigationContainerRef();

  useEffect(() => {
    if (!Platform.isTV) return;

    const sub = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (navigationRef.canGoBack()) {
          navigationRef.goBack();
          return true; // consume event
        }

        return false; // allow app exit on root screen
      }
    );

    return () => sub.remove();
  }, [navigationRef]);

  return (
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator
        initialRouteName="Splash"
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#000' },
          animation: 'none',
        }}
      >
        <Stack.Screen name="Splash" component={SplashScreen} />
        <Stack.Screen name="OTAUpdate" component={OTAUpdateScreen} />
        <Stack.Screen name="Selection" component={SelectionScreen} />
        <Stack.Screen name="SimpleUI" component={SimpleUIScreen} />
        <Stack.Screen name="AdvancedUI" component={AdvancedUIScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
};