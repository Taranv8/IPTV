import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
  useWindowDimensions,
  Platform,
  Easing,
  DimensionValue,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../types/navigation';
import { APP_CONFIG } from '../../constants/config';
import { useSettings } from '../../context/SettingsContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

type SelectionScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Selection'>;
interface Props { navigation: SelectionScreenNavigationProp; }

const FF = {
  black:     Platform.OS === 'android' ? 'sans-serif-black'     : 'AvenirNext-Heavy',
  medium:    Platform.OS === 'android' ? 'sans-serif-medium'    : 'AvenirNext-Medium',
  condensed: Platform.OS === 'android' ? 'sans-serif-condensed' : 'AvenirNext-Regular',
  light:     Platform.OS === 'android' ? 'sans-serif-light'     : 'AvenirNext-Regular',
};

// Google TV / Android TV boxes are frequently low-end (weak GPU/CPU, shared
// with video decode). We detect TV so we can trim animation load — fewer
// floating stars, slower loops — rather than paying full "phone" animation
// cost on constrained hardware.
const isTV = Platform.isTV === true;

// ─── Floating Star ────────────────────────────────────────────────────────────
// On TV: slower loop (less frequent re-renders of the native animation
// driver) and no rotation tween (rotation is the more expensive of the two
// interpolations since it runs the full duration vs. float's shorter one).
const FloatingStar: React.FC<{
  size: number; color: string;
  top: DimensionValue;
  left?: DimensionValue;
  right?: DimensionValue;
  delay?: number;
}> = ({ size, color, top, left, right, delay = 0 }) => {
  const floatY = useRef(new Animated.Value(0)).current;
  const rotate = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const floatDuration = isTV ? 2600 : 1800;
    const rotateDuration = isTV ? 6000 : 3600;

    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        isTV
          ? Animated.sequence([
              Animated.timing(floatY, { toValue: -10, duration: floatDuration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
              Animated.timing(floatY, { toValue: 0, duration: floatDuration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
            ])
          : Animated.parallel([
              Animated.sequence([
                Animated.timing(floatY, { toValue: -10, duration: floatDuration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
                Animated.timing(floatY, { toValue: 0, duration: floatDuration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
              ]),
              Animated.timing(rotate, { toValue: 1, duration: rotateDuration, easing: Easing.linear, useNativeDriver: true }),
            ]),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  const rot = rotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <Animated.View
      style={{
        position: 'absolute', top, left, right, opacity: 0.65,
        transform: isTV ? [{ translateY: floatY }] : [{ translateY: floatY }, { rotate: rot }],
      }}
      pointerEvents="none"
    >
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ position: 'absolute', width: size, height: size * 0.28, backgroundColor: color, borderRadius: size * 0.14 }} />
        <View style={{ position: 'absolute', width: size * 0.28, height: size, backgroundColor: color, borderRadius: size * 0.14 }} />
        <View style={{ position: 'absolute', width: size * 0.7, height: size * 0.7 * 0.28, backgroundColor: color, borderRadius: size * 0.14, transform: [{ rotate: '45deg' }] }} />
        <View style={{ position: 'absolute', width: size * 0.7 * 0.28, height: size * 0.7, backgroundColor: color, borderRadius: size * 0.14, transform: [{ rotate: '45deg' }] }} />
      </View>
    </Animated.View>
  );
};

// ─── Pulse Dot ────────────────────────────────────────────────────────────────
// On TV: slower pulse cycle — same visual language, fewer animation frames
// scheduled per second over time.
const PulseDot: React.FC<{ color: string; size: number; style?: object }> = ({ color, size, style }) => {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const dur = isTV ? 1300 : 850;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.7, duration: dur, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: dur, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);
  return <Animated.View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, transform: [{ scale: pulse }] }, style]} />;
};

// ─── Main Screen ──────────────────────────────────────────────────────────────
const SelectionScreen: React.FC<Props> = ({ navigation }) => {
  const { setUIMode } = useSettings();
  const { width, height } = useWindowDimensions();
  const card2Ref = useRef<View>(null);
  const isPortrait  = height >= width;
  // isPhone: true when the shorter screen dimension is phone-sized
  const isPhone     = Math.min(width, height) < 500;
  const isAndroidPhone = Platform.OS === 'android' && isPhone;
  const isLandPhone = !isPortrait && isPhone;   // landscape phone e.g. 720×360
  const isPortPhone =  isPortrait && isPhone;   // portrait phone  e.g. 390×844

  // Simple UI is not fully developed yet — Advanced is the only selectable
  // mode until the Simple UI ships over the air. Selection is locked rather
  // than left to uiMode/isAndroidPhone branching.
  const selectedUI: 'advanced' = 'advanced';
  const [focusedUI, setFocusedUI] = useState<'advanced' | null>('advanced');
  const [countdown, setCountdown] = useState(() =>
    isAndroidPhone ? 2 : APP_CONFIG.UI_SELECTION_COUNTDOWN
  );

  // ── Animations ──
  const masterFade  = useRef(new Animated.Value(0)).current;
  const titleSlide  = useRef(new Animated.Value(-36)).current;
  const card1Slide  = useRef(new Animated.Value(50)).current;
  const card2Slide  = useRef(new Animated.Value(50)).current;
  const bottomSlide = useRef(new Animated.Value(36)).current;
  const iconBounce2 = useRef(new Animated.Value(0)).current;
  const card2Scale  = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(masterFade, { toValue: 1, duration: 450, useNativeDriver: true }),
      Animated.spring(titleSlide, { toValue: 0, tension: 80, friction: 10, useNativeDriver: true }),
      Animated.sequence([Animated.delay(140), Animated.spring(card1Slide, { toValue: 0, tension: 70, friction: 10, useNativeDriver: true })]),
      Animated.sequence([Animated.delay(230), Animated.spring(card2Slide, { toValue: 0, tension: 70, friction: 10, useNativeDriver: true })]),
      Animated.sequence([Animated.delay(360), Animated.spring(bottomSlide, { toValue: 0, tension: 70, friction: 10, useNativeDriver: true })]),
    ]).start(() => {
      // Simple UI is disabled — send initial focus straight to Advanced so
      // the remote never lands on the locked card.
      card2Ref.current?.focus();
    });

    // Only one bounce loop now (Advanced card icon). On TV it runs slower
    // and the "rest" delay between bounces is longer, cutting scheduled
    // animation frames roughly in half compared to the previous two-loop version.
    const bounceDelay = isTV ? 1400 : 700;
    const restDelay    = isTV ? 3200 : 2000;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(bounceDelay),
        Animated.timing(iconBounce2, { toValue: -10, duration: 340, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(iconBounce2, { toValue: 0,   duration: 300, easing: Easing.bounce,           useNativeDriver: true }),
        Animated.delay(restDelay),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  const handleNavigate = useCallback(async () => {
    // Locked to Advanced UI while Simple UI is under development.
    await setUIMode('advanced');
    navigation.replace('AdvancedUI');
  }, [navigation, setUIMode]);

  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          setTimeout(() => handleNavigate(), 0);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [handleNavigate]);

  const popCard = useCallback((scale: Animated.Value) => {
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.94, duration: 80, useNativeDriver: true }),
      Animated.spring(scale,  { toValue: 1,    tension: 220, friction: 7, useNativeDriver: true }),
    ]).start();
  }, []);

  const handleSelectAdvanced = useCallback(() => {
    setFocusedUI('advanced');
    setCountdown(isAndroidPhone ? 2 : APP_CONFIG.UI_SELECTION_COUNTDOWN);
    popCard(card2Scale);
  }, [popCard, card2Scale, isAndroidPhone]);

  // ── Responsive token table ─────────────────────────────────────────────────
  const R = {
    headerPT:    isLandPhone ? 8  : isPortPhone ? 14 : 26,
    headerPB:    isLandPhone ? 4  : isPortPhone ? 8  : 10,
    badgeMB:     isLandPhone ? 3  : isPortPhone ? 6  : 10,
    badgeFz:     isLandPhone ? 9  : 11,
    titleFz:     isLandPhone ? 18 : isPortPhone ? 23 : 36,
    showSub:     !isLandPhone,
    subFz:       isPortPhone ? 12 : 14,
    subMT:       isPortPhone ? 3  : 6,

    iconCircleW: isLandPhone ? 44 : isPortPhone ? 56 : 74,
    iconSz:      isLandPhone ? 23 : isPortPhone ? 29 : 44,
    iconMB:      isLandPhone ? 5  : isPortPhone ? 8  : 14,

    cardPadV:    isLandPhone ? 8  : isPortPhone ? 12 : 18,
    cardPadH:    isLandPhone ? 10 : isPortPhone ? 14 : 18,
    card1MB:     isPortPhone ? 6  : isLandPhone ? 0 : 10,
    cardTitleFz: isLandPhone ? 14 : isPortPhone ? 17 : 20,
    cardDescFz:  isLandPhone ? 11 : isPortPhone ? 12 : 13,
    cardDescMB:  isLandPhone ? 5  : isPortPhone ? 8  : 14,
    cardDescLine:isLandPhone ? 1  : 2,
    cardDescTxt: (full: string, short: string) => isLandPhone ? short : full,

    vsBubbleW:   isLandPhone ? 26 : isPortPhone ? 28 : 34,
    vsTextFz:    isLandPhone ? 9  : isPortPhone ? 9  : 11,

    ringSize:    isLandPhone ? 42 : isPortPhone ? 52 : 66,
    ringNumFz:   isLandPhone ? 16 : isPortPhone ? 19 : 23,
    ringLblFz:   isLandPhone ? 7  : isPortPhone ? 9  : 10,
    ringMR:      isLandPhone ? 10 : 14,

    bPadV:       isLandPhone ? 7  : isPortPhone ? 9  : 13,
    bPadH:       isLandPhone ? 12 : isPortPhone ? 14 : 22,
    bMargH:      isLandPhone ? 10 : isPortPhone ? 12 : 20,
    bMargB:      isLandPhone ? 8  : isPortPhone ? 10 : 16,
    redirFz:     isLandPhone ? 11 : isPortPhone ? 12 : 14,
    hintFz:      isPortPhone ? 10 : 11,
    showHint:    !isLandPhone,
    showRemote:  !isLandPhone,
    remoteIconSz:isPortPhone ? 17 : 21,
    remoteFz:    isPortPhone ? 9  : 10,
  };

  // Background dot grid is purely decorative and was previously 60 absolute
  // Views (6x10). On TV we cut it to a sparse 3x5 (15 views); off TV we keep
  // it lighter too (4x8 = 32) since it added no functional value at full density.
  const bgGridRows = isTV ? 3 : 4;
  const bgGridCols = isTV ? 5 : 8;
  const bgGridSpacing = isTV ? 160 : 100;

  return (
    <Animated.View style={[styles.root, { opacity: masterFade }]}>

      {/* ── BG dots — reduced density, TV gets the sparsest grid ── */}
      <View style={styles.bgGrid} pointerEvents="none">
        {Array.from({ length: bgGridRows }).map((_, r) =>
          Array.from({ length: bgGridCols }).map((__, c) => (
            <View key={`${r}-${c}`} style={[styles.bgDot, { top: r * bgGridSpacing + 20, left: c * bgGridSpacing + 16 }]} />
          ))
        )}
      </View>

      {/* ── Stars — fewer on TV (2 instead of 4), skipped entirely on landscape phone ── */}
      {!isLandPhone && (
        <>
          <FloatingStar size={isPortPhone ? 14 : 24} color="#FFD700" top="6%" left="4%" delay={0} />
          <FloatingStar size={isPortPhone ? 11 : 17} color="#00F5FF" top="9%" right="5%" delay={500} />
          {!isTV && (
            <>
              <FloatingStar size={isPortPhone ? 12 : 19} color="#FF4757" top="78%" left="3%" delay={900} />
              <FloatingStar size={isPortPhone ? 9  : 13} color="#A29BFE" top="75%" right="4%" delay={300} />
            </>
          )}
        </>
      )}

      {/* ═══════ HEADER ═══════ */}
      <Animated.View style={[styles.header, {
        paddingTop:    R.headerPT,
        paddingBottom: R.headerPB,
        transform: [{ translateY: titleSlide }],
      }]}>
        <View style={[styles.badge, { marginBottom: R.badgeMB }]}>
          <PulseDot color="#FF4757" size={7} style={{ marginRight: 6 }} />
          <Text style={[styles.badgeText, { fontSize: R.badgeFz }]}>LIVE TV</Text>
        </View>
        <Text
          style={[styles.title, { fontSize: R.titleFz }]}
          numberOfLines={1}
          // adjustsFontSizeToFit forces iterative text-measurement passes,
          // which is real CPU cost on weak TV chipsets. R.titleFz already
          // computes the right size per layout class, so we only enable the
          // shrink-to-fit behavior on phone where copy/dynamic-type variance
          // is more likely; TV skips it and trusts the fixed R.titleFz.
          adjustsFontSizeToFit={!isTV}
          minimumFontScale={0.8}
        >
          Choose Your Experience
        </Text>
        {R.showSub && (
          <Text style={[styles.subtitle, { fontSize: R.subFz, marginTop: R.subMT }]} numberOfLines={1}>
            Pick the interface that feels right for you
          </Text>
        )}
      </Animated.View>

      {/* ═══════ CARDS ═══════ */}
      <View style={[
        styles.cardsRow,
        isPortrait ? styles.cardsColumn : styles.cardsRow2,
      ]}>
        {/* ─── Card 1: Simple UI — DISABLED, not fully developed yet ───
            Not focusable: focusable={false} + accessibilityElementsHidden
            + importantForAccessibility="no" ensure the TV remote's D-pad
            navigation skips straight past this card to Advanced UI. */}
        <Animated.View style={[
          styles.cardWrap,
          isPortrait ? styles.cardWrapPortrait : styles.cardWrapLandscape,
          { transform: [{ translateY: card1Slide }] },
          isPortrait && { marginBottom: R.card1MB },
        ]}>
          <View
            style={[
              styles.card,
              styles.cardDisabled,
              { paddingVertical: R.cardPadV, paddingHorizontal: R.cardPadH },
            ]}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <View style={[styles.cardGlow, { backgroundColor: 'rgba(255,255,255,0.02)' }]} />

            <View style={styles.lockBadge}>
              <Icon name="lock-clock" size={12} color="#5A6278" />
              <Text style={styles.lockBadgeTxt}>COMING SOON</Text>
            </View>

            <View style={[styles.iconCircle, styles.iconDisabled, {
              width: R.iconCircleW, height: R.iconCircleW, borderRadius: R.iconCircleW / 2, marginBottom: R.iconMB,
            }]}>
              <Icon name="television-play" size={R.iconSz} color="#3D4451" />
            </View>

            <Text style={[styles.cardTitle, styles.cardTitleDisabled, { fontSize: R.cardTitleFz }]} numberOfLines={1}>
              Simple UI
            </Text>
            <Text style={[styles.cardDesc, styles.cardDescDisabled, { fontSize: R.cardDescFz, marginBottom: R.cardDescMB }]} numberOfLines={R.cardDescLine}>
              {R.cardDescTxt('Not fully developed \u2014 arriving in a future OTA update', 'Arriving via OTA update')}
            </Text>
            <View style={[styles.stripe, { backgroundColor: '#1E2030' }]} />
          </View>
        </Animated.View>

        {/* ─── VS Divider ─── */}
        {isPortrait ? (
          <View style={[styles.vsDivH, { marginBottom: R.card1MB }]}>
            <View style={styles.vsDivLineH} />
            <View style={[styles.vsBubble, { width: R.vsBubbleW, height: R.vsBubbleW, borderRadius: R.vsBubbleW / 2, marginHorizontal: 7 }]}>
              <Text style={[styles.vsText, { fontSize: R.vsTextFz }]}>VS</Text>
            </View>
            <View style={styles.vsDivLineH} />
          </View>
        ) : (
          <View style={styles.vsDivV}>
            <View style={styles.vsDivLineV} />
            <View style={[styles.vsBubble, { width: R.vsBubbleW, height: R.vsBubbleW, borderRadius: R.vsBubbleW / 2, marginVertical: 8 }]}>
              <Text style={[styles.vsText, { fontSize: R.vsTextFz }]}>VS</Text>
            </View>
            <View style={styles.vsDivLineV} />
          </View>
        )}

        {/* ─── Card 2: Advanced UI — the only selectable option ─── */}
        <Animated.View style={[
          styles.cardWrap,
          isPortrait ? styles.cardWrapPortrait : styles.cardWrapLandscape,
          { transform: [{ translateY: card2Slide }, { scale: card2Scale }] },
        ]}>
          <Pressable
            ref={card2Ref}
            focusable
            hasTVPreferredFocus
            onPress={handleSelectAdvanced}
            onFocus={() => setFocusedUI('advanced')}
            style={[
              styles.card,
              { paddingVertical: R.cardPadV, paddingHorizontal: R.cardPadH },
              styles.cardAdvanced,
              focusedUI === 'advanced' && styles.cardFocused,
            ]}
          >
            <View style={[styles.cardGlow, { backgroundColor: 'rgba(255,215,0,0.08)' }]} />
            <View style={[styles.cornerTag, { backgroundColor: '#FFD700' }]}>
              <Text style={[styles.cornerTagTxt, { color: '#0D0D1A' }]}>✓</Text>
            </View>

            <Animated.View style={{ transform: [{ translateY: iconBounce2 }] }}>
              <View style={[styles.iconCircle, {
                width: R.iconCircleW, height: R.iconCircleW, borderRadius: R.iconCircleW / 2, marginBottom: R.iconMB,
              }, styles.iconAdvanced]}>
                <Icon name="view-grid" size={R.iconSz} color="#FFD700" />
              </View>
            </Animated.View>

            <Text style={[styles.cardTitle, { fontSize: R.cardTitleFz }, styles.cardTitleAdv]} numberOfLines={1}>
              Advanced UI
            </Text>
            <Text style={[styles.cardDesc, { fontSize: R.cardDescFz, marginBottom: R.cardDescMB }]} numberOfLines={R.cardDescLine}>
              {R.cardDescTxt('Visual grid • Thumbnails • Smart discovery', 'Grid view • Thumbnails')}
            </Text>
            <View style={[styles.stripe, { backgroundColor: '#FFD700' }]} />
          </Pressable>
        </Animated.View>
      </View>

      {/* ═══════ BOTTOM BAR ═══════ */}
      <Animated.View style={[
        styles.bottomBar,
        {
          paddingVertical:   R.bPadV,
          paddingHorizontal: R.bPadH,
          marginHorizontal:  R.bMargH,
          marginBottom:      R.bMargB,
          transform: [{ translateY: bottomSlide }],
        },
      ]}>
        {/* Countdown ring */}
        <View style={[styles.ring, {
          width: R.ringSize, height: R.ringSize, borderRadius: R.ringSize / 2, marginRight: R.ringMR,
        }]}>
          <Text style={[styles.ringNum, { fontSize: R.ringNumFz }]}>{countdown}</Text>
          <Text style={[styles.ringLbl, { fontSize: R.ringLblFz }]}>sec</Text>
        </View>

        {/* Text block */}
        <View style={styles.bottomCenter}>
          <Text style={[styles.redirectText, { fontSize: R.redirFz }]}>
            {'Redirecting to '}
            <Text style={{ color: '#FFD700', fontFamily: FF.black }}>Advanced UI</Text>
          </Text>
          {R.showHint && (
            <Text style={[styles.hintText, { fontSize: R.hintFz }]}>Simple UI arrives via OTA update</Text>
          )}
        </View>

        {/* Remote hint */}
        {R.showRemote && (
          <View style={[styles.remoteHint, { marginLeft: 14 }]}>
            <Icon name="remote-tv" size={R.remoteIconSz} color="#374151" />
            <Text style={[styles.remoteTxt, { fontSize: R.remoteFz, marginTop: 3 }]}>OK to select</Text>
          </View>
        )}
      </Animated.View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0D0D1A',
    overflow: 'hidden',
  },

  bgGrid: { ...StyleSheet.absoluteFillObject },
  bgDot:  { position: 'absolute', width: 3, height: 3, borderRadius: 1.5, backgroundColor: '#fff', opacity: 0.05 },

  header: {
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,71,87,0.13)',
    borderWidth: 1.5,
    borderColor: '#FF4757',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  badgeText: {
    fontFamily: FF.black,
    fontWeight: '900',
    color: '#FF4757',
    letterSpacing: 2.5,
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: FF.black,
    fontWeight: '900',
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: -0.5,
    textShadowColor: 'rgba(0,245,255,0.22)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 16,
  },
  subtitle: {
    fontFamily: FF.medium,
    fontWeight: '500',
    color: '#8B93A5',
    letterSpacing: 0.3,
    textAlign: 'center',
  },

  cardsRow: {
    flex: 1,
    paddingHorizontal: 6,
  },
  cardsColumn: {
    flexDirection: 'column',
    alignItems: 'stretch',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  cardsRow2: {
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'center',
    paddingVertical: 6,
  },

  cardWrap: {
    flex: 1,
  },
  cardWrapPortrait: {
    alignSelf: 'stretch',
    marginHorizontal: 14,
  },
  cardWrapLandscape: {
    alignSelf: 'stretch',
    marginHorizontal: 8,
  },

  card: {
    flex: 1,
    backgroundColor: '#161626',
    borderRadius: 18,
    borderWidth: 2.5,
    borderColor: '#252535',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 3, height: 5 },
    shadowOpacity: 0.6,
    shadowRadius: 0,
    elevation: 8,
  },
  cardAdvanced: {
    borderColor: '#FFD700',
    backgroundColor: '#1D1800',
    shadowColor: '#FFD700',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
    elevation: 14,
  },
  cardFocused: {
    borderColor: '#ff4d4d',
    borderWidth: 4,
    shadowColor: '#ff4d4d',
    shadowOpacity: 0.7,
    shadowRadius: 20,
    elevation: 20,
    transform: [{ scale: 1.02 }],
  },
  cardDisabled: {
    backgroundColor: '#121220',
    borderColor: '#1B1B2A',
    opacity: 0.55,
    shadowOpacity: 0,
    elevation: 0,
  },

  lockBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(90,98,120,0.14)',
    borderWidth: 1,
    borderColor: '#3A3F52',
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  lockBadgeTxt: {
    fontFamily: FF.black,
    fontWeight: '900',
    fontSize: 8,
    color: '#5A6278',
    letterSpacing: 1.2,
    marginLeft: 4,
  },

  cardGlow: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 15,
  },

  cornerTag: {
    position: 'absolute', top: 0, right: 0,
    width: 28, height: 28,
    backgroundColor: '#00F5FF',
    borderBottomLeftRadius: 11,
    borderTopRightRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cornerTagTxt: {
    fontFamily: FF.black,
    fontSize: 11,
    fontWeight: '900',
    color: '#0D0D1A',
  },

  iconCircle: {
    backgroundColor: '#1A1A2E',
    borderWidth: 2,
    borderColor: '#2C2C42',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconAdvanced: { backgroundColor: 'rgba(255,215,0,0.08)', borderColor: '#FFD700' },
  iconDisabled: { backgroundColor: 'rgba(255,255,255,0.02)', borderColor: '#20202E' },

  cardTitle: {
    fontFamily: FF.black,
    fontWeight: '900',
    color: '#3D4451',
    textAlign: 'center',
    letterSpacing: 0.4,
    marginBottom: 5,
  },
  cardTitleAdv:      { color: '#FFD700' },
  cardTitleDisabled: { color: '#454C5E' },

  cardDesc: {
    fontFamily: FF.medium,
    fontWeight: '500',
    color: '#5A6278',
    textAlign: 'center',
    lineHeight: 17,
    letterSpacing: 0.1,
    maxWidth: 230,
  },
  cardDescDisabled: { color: '#3F4557' },

  stripe: {
    height: 3,
    width: '52%',
    borderRadius: 2,
  },

  vsDivH: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 28,
  },
  vsDivLineH: { flex: 1, height: 1.5, backgroundColor: '#1A1A2E' },

  vsDivV: {
    flexDirection: 'column',
    alignItems: 'center',
    alignSelf: 'stretch',
    width: 38,
  },
  vsDivLineV: { flex: 1, width: 1.5, backgroundColor: '#1A1A2E' },

  vsBubble: {
    backgroundColor: '#16162A',
    borderWidth: 1.5,
    borderColor: '#26263C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  vsText: {
    fontFamily: FF.black,
    fontWeight: '900',
    color: '#2E3344',
    letterSpacing: 1,
  },

  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(18, 18, 32, 0.96)',
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: '#1A1A2E',
  },
  ring: {
    borderWidth: 3.5,
    borderColor: '#FFD700',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,215,0,0.07)',
    shadowColor: '#FFD700',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.75,
    shadowRadius: 9,
    elevation: 9,
  },
  ringNum: {
    fontFamily: FF.black,
    fontWeight: '900',
    color: '#FFD700',
  },
  ringLbl: {
    fontFamily: FF.medium,
    fontWeight: '500',
    color: '#FFD700',
    opacity: 0.75,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginTop: -2,
  },
  bottomCenter: {
    flex: 1,
    alignItems: 'center',
  },
  redirectText: {
    fontFamily: FF.medium,
    fontWeight: '500',
    color: '#C9D0DC',
    textAlign: 'center',
  },
  hintText: {
    fontFamily: FF.medium,
    fontWeight: '500',
    color: '#4A5268',
    textAlign: 'center',
    marginTop: 2,
    letterSpacing: 0.1,
  },
  remoteHint: {
    alignItems: 'center',
  },
  remoteTxt: {
    fontFamily: FF.medium,
    fontWeight: '500',
    color: '#3A4155',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
});

export default SelectionScreen;