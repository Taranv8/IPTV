// src/hooks/useOrientation.ts
import { useState, useEffect } from 'react';
import { Dimensions, Platform } from 'react-native';

export type Orientation = 'portrait' | 'landscape';

export interface OrientationInfo {
  orientation: Orientation;
  width: number;
  height: number;
  isTV: boolean;
  isLandscape: boolean;
  isPortrait: boolean;
}

export function useOrientation(): OrientationInfo {
  const [dims, setDims] = useState(() => Dimensions.get('window'));

  useEffect(() => {
    const subscription = Dimensions.addEventListener('change', ({ window }) => {
      setDims(window);
    });
    return () => subscription?.remove();
  }, []);

  const isLandscape = dims.width > dims.height;
  const isTV = Platform.isTV;

  return {
    orientation: isLandscape ? 'landscape' : 'portrait',
    width: dims.width,
    height: dims.height,
    isTV,
    isLandscape,
    isPortrait: !isLandscape,
  };
}