import 'react-native';

declare module 'react-native' {
  interface PressableProps {
    nextFocusUp?: number;
    nextFocusDown?: number;
    nextFocusLeft?: number;
    nextFocusRight?: number;
    nextFocusForward?: number;
  }
}