import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../constants/config';

interface SettingsContextType {
  uiMode: 'simple' | 'advanced';
  setUIMode: (mode: 'simple' | 'advanced') => void;
  autoHideControls: boolean;
  setAutoHideControls: (value: boolean) => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const SettingsProvider = ({ children }: { children: ReactNode }) => {
  const [uiMode, setUIModeState] = useState<'simple' | 'advanced'>('simple');
  const [autoHideControls, setAutoHideControls] = useState(true);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const savedMode = await AsyncStorage.getItem(STORAGE_KEYS.UI_MODE);
      if (savedMode) {
        setUIModeState(savedMode as 'simple' | 'advanced');
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  };

  const setUIMode = async (mode: 'simple' | 'advanced') => {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.UI_MODE, mode);
      setUIModeState(mode);
    } catch (error) {
      console.error('Error saving UI mode:', error);
    }
  };

  return (
    <SettingsContext.Provider
      value={{
        uiMode,
        setUIMode,
        autoHideControls,
        setAutoHideControls,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within SettingsProvider');
  }
  return context;
};