import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../../types/navigation';
import { APP_CONFIG } from '../../constants/config';
import { useSettings } from '../../context/SettingsContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

type SelectionScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Selection'>;

interface Props {
  navigation: SelectionScreenNavigationProp;
}

const SelectionScreen: React.FC<Props> = ({ navigation }) => {
  const { uiMode, setUIMode } = useSettings();
  const [selectedUI, setSelectedUI] = useState<'simple' | 'advanced'>(uiMode);
  const [countdown, setCountdown] = useState(APP_CONFIG.SELECTION_COUNTDOWN);
  const scaleAnim = new Animated.Value(1);

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    } else {
      handleNavigate();
    }
  }, [countdown]);

 const handleNavigate = async () => {
  await setUIMode(selectedUI);
  
  if (selectedUI === 'simple') {
    navigation.replace('SimpleUI', {});
  } else {
    navigation.replace('AdvancedUI');
  }
};
  const handleSelect = (mode: 'simple' | 'advanced') => {
    setSelectedUI(mode);
    setCountdown(APP_CONFIG.SELECTION_COUNTDOWN);
    
    Animated.sequence([
      Animated.timing(scaleAnim, {
        toValue: 1.05,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start();
  };

  return (
    <View style={styles.container}>
      {/* Grid Background */}
      <View style={styles.gridBackground} />

      <View style={styles.content}>
        <Text style={styles.title}>Choose Your Experience</Text>
        <Text style={styles.description}>Select the interface that suits you best</Text>

        <View style={styles.optionsContainer}>
          {/* Simple UI Option */}
          <TouchableOpacity
            onPress={() => handleSelect('simple')}
            style={[
              styles.option,
              selectedUI === 'simple' && styles.optionSelected,
            ]}
            activeOpacity={0.8}
          >
            <View style={styles.optionGlow} />
            <Icon
              name="television"
              size={80}
              color="#fff"
              style={styles.optionIcon}
            />
            <Text style={styles.optionTitle}>Simple UI</Text>
            <Text style={styles.optionDescription}>
              Classic TV experience like DishTV with instant channel switching and numeric keypad
            </Text>
            {selectedUI === 'simple' && (
              <View style={styles.selectedIndicator}>
                <View style={styles.selectedDot} />
              </View>
            )}
          </TouchableOpacity>

          {/* Advanced UI Option */}
          <TouchableOpacity
            onPress={() => handleSelect('advanced')}
            style={[
              styles.option,
              selectedUI === 'advanced' && styles.optionSelectedAdvanced,
            ]}
            activeOpacity={0.8}
          >
            <View style={styles.optionGlow} />
            <Icon
              name="grid"
              size={80}
              color="#fff"
              style={styles.optionIcon}
            />
            <Text style={styles.optionTitle}>Advanced UI</Text>
            <Text style={styles.optionDescription}>
              Modern grid interface with visual thumbnails for easy browsing and discovery
            </Text>
            {selectedUI === 'advanced' && (
              <View style={styles.selectedIndicator}>
                <View style={[styles.selectedDot, styles.selectedDotAdvanced]} />
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* Countdown */}
        <View style={styles.countdownContainer}>
          <Text style={styles.countdownText}>
            Redirecting in {countdown}s
          </Text>
          <Text style={styles.countdownSubtext}>Click to change selection</Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f0f',
  },
  gridBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  title: {
    fontSize: 40,
    fontWeight: '900',
    color: '#fff',
    marginBottom: 8,
    textAlign: 'center',
  },
  description: {
    fontSize: 16,
    color: '#9ca3af',
    marginBottom: 64,
    textAlign: 'center',
  },
  optionsContainer: {
    flexDirection: 'row',
    gap: 48,
    marginBottom: 48,
  },
  option: {
    width: 300,
    backgroundColor: '#1f2937',
    borderRadius: 24,
    padding: 40,
    alignItems: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  optionSelected: {
    backgroundColor: '#2563eb',
  },
  optionSelectedAdvanced: {
    backgroundColor: '#7c3aed',
  },
  optionGlow: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: '#fff',
    opacity: 0.05,
  },
  optionIcon: {
    marginBottom: 24,
  },
  optionTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 16,
  },
  optionDescription: {
    fontSize: 14,
    color: '#e5e7eb',
    textAlign: 'center',
    lineHeight: 20,
  },
  selectedIndicator: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectedDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#2563eb',
  },
  selectedDotAdvanced: {
    backgroundColor: '#7c3aed',
  },
  countdownContainer: {
    backgroundColor: 'rgba(31, 41, 55, 0.5)',
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#374151',
  },
  countdownText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 4,
  },
  countdownSubtext: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
  },
});

export default SelectionScreen;