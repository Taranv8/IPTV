// src/screens/splash/SplashScreen.tsx
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Platform, Dimensions } from 'react-native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../../types/navigation';
import { APP_CONFIG } from '../../constants/config';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

type SplashScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Splash'>;

interface Props {
  navigation: SplashScreenNavigationProp;
}

const SplashScreen: React.FC<Props> = ({ navigation }) => {
  // ✅ useRef — animation value is stable across re-renders
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const { width, height } = Dimensions.get('window');
  const isTV = Platform.isTV;
  const isLandscape = width > height;

  // Responsive icon / font sizes
  const iconSize = isTV ? 180 : isLandscape ? 90 : 120;
  const titleSize = isTV ? 72 : isLandscape ? 36 : 48;
  const subtitleSize = isTV ? 26 : isLandscape ? 16 : 20;
  const circleScale = Math.min(width, height) / 400; // scale decorative circles to screen

  useEffect(() => {
    // Fade-in entrance
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      useNativeDriver: true,
    }).start();

    // Pulse loop
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.15,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
        }),
      ]),
    );
    pulse.start();

    const timer = setTimeout(() => {
      navigation.replace('Selection');
    }, APP_CONFIG.SPLASH_DURATION);

    return () => {
      pulse.stop();
      clearTimeout(timer);
    };
  }, [navigation, pulseAnim, fadeAnim]);

  return (
    <View style={styles.container}>
      {/* Decorative circles — sized relative to screen, not hardcoded px */}
      <View
        style={[
          styles.circle1,
          {
            width: 280 * circleScale,
            height: 280 * circleScale,
            borderRadius: 140 * circleScale,
          },
        ]}
      />
      <View
        style={[
          styles.circle2,
          {
            width: 360 * circleScale,
            height: 360 * circleScale,
            borderRadius: 180 * circleScale,
          },
        ]}
      />

      {/* Main content */}
      <Animated.View style={[styles.content, { opacity: fadeAnim }]}>
        <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
          <Icon name="television" size={iconSize} color="#fff" />
        </Animated.View>

        <Text style={[styles.title, { fontSize: titleSize }]}>
          {APP_CONFIG.APP_NAME}
        </Text>

        <View style={styles.divider} />

        <Text style={[styles.subtitle, { fontSize: subtitleSize }]}>
          Premium IPTV Experience
        </Text>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1e1b4b',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Decorative circles — position as % so they work in any orientation
  circle1: {
    position: 'absolute',
    top: '10%',
    left: '10%',
    backgroundColor: '#3b82f6',
    opacity: 0.2,
  },
  circle2: {
    position: 'absolute',
    bottom: '10%',
    right: '10%',
    backgroundColor: '#8b5cf6',
    opacity: 0.2,
  },

  content: {
    alignItems: 'center',
    zIndex: 10,
    paddingHorizontal: 24,
  },
  title: {
    fontWeight: '900',
    color: '#fff',
    letterSpacing: 2,
    marginTop: 24,
    marginBottom: 16,
    textAlign: 'center',
  },
  divider: {
    width: '60%',
    maxWidth: 240,
    height: 4,
    backgroundColor: '#3b82f6',
    borderRadius: 2,
    marginBottom: 16,
  },
  subtitle: {
    color: '#bfdbfe',
    fontWeight: '300',
    textAlign: 'center',
  },
});

export default SplashScreen;