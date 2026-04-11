import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  useWindowDimensions,
  ScrollView,
  Platform,
} from 'react-native';
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
  const { width, height } = useWindowDimensions();

  const isPortrait = height >= width;
  const isSmallScreen = width < 700;

  const [selectedUI, setSelectedUI] = useState<'simple' | 'advanced'>(uiMode);
  const [focusedUI, setFocusedUI] = useState<'simple' | 'advanced' | null>(uiMode);
  const [countdown, setCountdown] = useState(APP_CONFIG.UI_SELECTION_COUNTDOWN);

  const scaleAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
    handleNavigate();
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
    setFocusedUI(mode);
    setCountdown(APP_CONFIG.UI_SELECTION_COUNTDOWN);

    Animated.sequence([
      Animated.timing(scaleAnim, {
        toValue: 1.04,
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

const cardWidth = isPortrait
  ? '100%'
  : Math.min(320, width * 0.40); 
  const descSize = isSmallScreen ? 14 : 16;
  const iconSize = isSmallScreen ? 64 : 80;
const titleSize = isSmallScreen ? 28 : 40;
  return (
    <View style={styles.container}>
      <View style={styles.gridBackground} />

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          isPortrait ? styles.scrollContentPortrait : styles.scrollContentLandscape,
        ]}
        bounces={false}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.content}>
          <Text
            style={[
              styles.title,
              { fontSize: titleSize },
            ]}
            numberOfLines={2}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
          >
            Choose Your Experience
          </Text>

          <Text
            style={[
              styles.description,
              { fontSize: descSize },
            ]}
            numberOfLines={3}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
          >
            Select the interface that suits you best
          </Text>

          <View
            style={[
              styles.optionsContainer,
              isPortrait ? styles.optionsContainerPortrait : styles.optionsContainerLandscape,
            ]}
          >
            <TouchableOpacity
              focusable
              hasTVPreferredFocus={selectedUI === 'simple'}
              onPress={() => handleSelect('simple')}
              onFocus={() => setFocusedUI('simple')}
              onBlur={() => setFocusedUI(null)}
              activeOpacity={0.8}
              style={[
  styles.option,
  { width: cardWidth },
  !isPortrait && { marginHorizontal: 12 }, // 👈 adds gap in landscape
  selectedUI === 'simple' && styles.optionSelected,
  focusedUI === 'simple' && styles.optionFocused,
]}
            >
              <View style={styles.optionGlow} />
              <Icon name="television" size={iconSize} color="#fff" style={styles.optionIcon} />
              <Text
                style={[
                  styles.optionTitle,
                  { fontSize: isSmallScreen ? 20 : 24 },
                ]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
              >
                Simple UI
              </Text>
              <Text
                style={[
                  styles.optionDescription,
                  { fontSize: isSmallScreen ? 13 : 14 },
                ]}
                numberOfLines={4}
                ellipsizeMode="tail"
              >
                Classic TV experience like DishTV with instant channel switching and numeric keypad
              </Text>

              {selectedUI === 'simple' && (
                <View style={styles.selectedIndicator}>
                  <View style={styles.selectedDot} />
                </View>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              focusable
              onPress={() => handleSelect('advanced')}
              onFocus={() => setFocusedUI('advanced')}
              onBlur={() => setFocusedUI(null)}
              activeOpacity={0.8}
              style={[
                styles.option,
                { width: cardWidth },
                selectedUI === 'advanced' && styles.optionSelectedAdvanced,
                focusedUI === 'advanced' && styles.optionFocused,
              ]}
            >
              <View style={styles.optionGlow} />
              <Icon name="grid" size={iconSize} color="#fff" style={styles.optionIcon} />
              <Text
                style={[
                  styles.optionTitle,
                  { fontSize: isSmallScreen ? 20 : 24 },
                ]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
              >
                Advanced UI
              </Text>
              <Text
                style={[
                  styles.optionDescription,
                  { fontSize: isSmallScreen ? 13 : 14 },
                ]}
                numberOfLines={4}
                ellipsizeMode="tail"
              >
                Modern grid interface with visual thumbnails for easy browsing and discovery
              </Text>

              {selectedUI === 'advanced' && (
                <View style={styles.selectedIndicator}>
                  <View style={[styles.selectedDot, styles.selectedDotAdvanced]} />
                </View>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.countdownContainer}>
            <Text
              style={[
                styles.countdownText,
                { fontSize: isSmallScreen ? 18 : 24 },
              ]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              Redirecting in {countdown}s
            </Text>
            <Text
              style={[
                styles.countdownSubtext,
                { fontSize: isSmallScreen ? 12 : 14 },
              ]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              Click to change selection
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f0f',
  },
  gridBackground: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  scrollContentPortrait: {
    paddingVertical: 24,
  },
  scrollContentLandscape: {
    paddingVertical: 32,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  title: {
    fontWeight: '900',
    color: '#fff',
    marginBottom: 8,
    textAlign: 'center',
    flexShrink: 1,
  },
  description: {
    color: '#9ca3af',
    marginBottom: 32,
    textAlign: 'center',
    flexShrink: 1,
    maxWidth: 700,
    lineHeight: 22,
  },
  optionsContainer: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionsContainerLandscape: {
  flexDirection: 'row',
  justifyContent: 'center', // 👈 ensures equal spacing
  alignItems: 'center',
},
  optionsContainerPortrait: {
    flexDirection: 'column',
  },
  option: {
    backgroundColor: '#1f2937',
    borderRadius: 24,
    paddingVertical: 28,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
    marginBottom: 18,
    minHeight: 280,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  optionSelected: {
    backgroundColor: '#2563eb',
  },
  optionSelectedAdvanced: {
    backgroundColor: '#7c3aed',
  },
  optionFocused: {
    borderColor: '#ff3b30',
    transform: [{ scale: 1.02 }],
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
    marginBottom: 20,
  },
  optionTitle: {
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 12,
    textAlign: 'center',
  },
  optionDescription: {
    color: '#e5e7eb',
    textAlign: 'center',
    lineHeight: 20,
    flexShrink: 1,
    maxWidth: 280,
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
    marginTop: 24,
    backgroundColor: 'rgba(31, 41, 55, 0.5)',
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#374151',
    alignSelf: 'center',
    maxWidth: '90%',
  },
  countdownText: {
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 4,
  },
  countdownSubtext: {
    color: '#9ca3af',
    textAlign: 'center',
  },
});

export default SelectionScreen;