import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { RootStackParamList } from '../types/navigation';
import SplashScreen     from '../screens/splash/SplashScreen';
import OTAUpdateScreen  from '../screens/ota/OTAUpdateScreen';   // ← ADD
import SelectionScreen  from '../screens/selection/SelectionScreen';
import SimpleUIScreen   from '../screens/simple/SimpleUIScreen';
import AdvancedUIScreen from '../screens/advanced/AdvancedUIScreen';
import SettingsScreen   from '../screens/settings/SettingsScreen';

const Stack = createStackNavigator<RootStackParamList>();

export const RootNavigator = () => {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Splash"
        screenOptions={{
          headerShown: false,
          cardStyle: { backgroundColor: '#000' },
          cardStyleInterpolator: () => ({}),
        }}
      >
        <Stack.Screen name="Splash"     component={SplashScreen}     />
        <Stack.Screen name="OTAUpdate"  component={OTAUpdateScreen}  />  {/* ← ADD */}
        <Stack.Screen name="Selection"  component={SelectionScreen}  />
        <Stack.Screen name="SimpleUI"   component={SimpleUIScreen}   />
        <Stack.Screen name="AdvancedUI" component={AdvancedUIScreen} />
        <Stack.Screen name="Settings"   component={SettingsScreen}   />
      </Stack.Navigator>
    </NavigationContainer>
  );
};