import { NativeModules, Platform } from 'react-native';

const { ImmersiveModule } = NativeModules;

export const enterImmersive = (): void => {
  if (Platform.OS === 'android' && !Platform.isTV && ImmersiveModule) {
    ImmersiveModule.enterImmersive();
  }
};

export const exitImmersive = (): void => {
  if (Platform.OS === 'android' && !Platform.isTV && ImmersiveModule) {
    ImmersiveModule.exitImmersive();
  }
};