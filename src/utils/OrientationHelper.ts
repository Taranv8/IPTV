import { NativeModules, Platform } from 'react-native';

const { OrientationModule } = NativeModules;

export const lockToLandscape = (): void => {
  if (Platform.OS === 'android' && !Platform.isTV && OrientationModule) {
    OrientationModule.lockToLandscape();
  }
};

export const lockToPortrait = (): void => {
  if (Platform.OS === 'android' && !Platform.isTV && OrientationModule) {
    OrientationModule.lockToPortrait();
  }
};