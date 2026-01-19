import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../../types/navigation';
import { APP_CONFIG } from '../../constants/config';
import { COLORS } from '../../constants/colors';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

type SplashScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Splash'>;

interface Props {
  navigation: SplashScreenNavigationProp;
}

const SplashScreen: React.FC<Props> = ({ navigation }) => {
  const pulseAnim = new Animated.Value(1);

  useEffect(() => {
    // Pulse animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.2,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    ).start();

    // Navigate to selection screen after delay
    const timer = setTimeout(() => {
      navigation.replace('Selection');
    }, APP_CONFIG.SPLASH_DURATION);

    return () => clearTimeout(timer);
  }, [navigation]);

  return (
    <View style={styles.container}>
      {/* Gradient Background Circles */}
      <View style={styles.circle1} />
      <View style={styles.circle2} />

      {/* Content */}
      <View style={styles.content}>
        <Animated.View style={[styles.iconContainer, { transform: [{ scale: pulseAnim }] }]}>
          <Icon name="television" size={120} color="#fff" />
        </Animated.View>
        
        <Text style={styles.title}>{APP_CONFIG.APP_NAME}</Text>
        <View style={styles.divider} />
        <Text style={styles.subtitle}>Premium IPTV Experience</Text>
      </View>
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
  circle1: {
    position: 'absolute',
    top: 80,
    left: 80,
    width: 288,
    height: 288,
    borderRadius: 144,
    backgroundColor: '#3b82f6',
    opacity: 0.2,
  },
  circle2: {
    position: 'absolute',
    bottom: 80,
    right: 80,
    width: 384,
    height: 384,
    borderRadius: 192,
    backgroundColor: '#8b5cf6',
    opacity: 0.2,
  },
  content: {
    alignItems: 'center',
    zIndex: 10,
  },
  iconContainer: {
    marginBottom: 32,
  },
  title: {
    fontSize: 56,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: 2,
    marginBottom: 16,
  },
  divider: {
    width: 256,
    height: 4,
    backgroundColor: '#3b82f6',
    marginBottom: 16,
  },
  subtitle: {
    fontSize: 20,
    color: '#bfdbfe',
    fontWeight: '300',
  },
});

export default SplashScreen;