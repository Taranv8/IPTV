import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  useWindowDimensions,
  Platform,
  Easing,
   DimensionValue,
} from 'react-native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../../types/navigation';
import { APP_CONFIG } from '../../constants/config';
import { useSettings } from '../../context/SettingsContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

type SelectionScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Selection'>;
interface Props { navigation: SelectionScreenNavigationProp; }

const card1Ref = useRef<React.ElementRef<typeof TouchableOpacity>>(null);
// ─── Floating Star ────────────────────────────────────────────────────────────
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
    Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.sequence([
            Animated.timing(floatY, { toValue: -10, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
            Animated.timing(floatY, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          ]),
          Animated.timing(rotate, { toValue: 1, duration: 3600, easing: Easing.linear, useNativeDriver: true }),
        ]),
      ])
    ).start();
  }, []);
  const rot = rotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View
      style={{ position: 'absolute', top, left, right, opacity: 0.65, transform: [{ translateY: floatY }, { rotate: rot }] }}
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
const PulseDot: React.FC<{ color: string; size: number; style?: object }> = ({ color, size, style }) => {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.7, duration: 850, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 850, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ])
    ).start();
  }, []);
  return <Animated.View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, transform: [{ scale: pulse }] }, style]} />;
};

// ─── Main Screen ──────────────────────────────────────────────────────────────
const SelectionScreen: React.FC<Props> = ({ navigation }) => {
  const { uiMode, setUIMode } = useSettings();
  const { width, height } = useWindowDimensions();

  const isPortrait  = height >= width;
  // isPhone: true when the shorter screen dimension is phone-sized
  const isPhone     = Math.min(width, height) < 500;
  const isLandPhone = !isPortrait && isPhone;   // landscape phone e.g. 720×360
  const isPortPhone =  isPortrait && isPhone;   // portrait phone  e.g. 390×844

  const [selectedUI, setSelectedUI] = useState<'simple' | 'advanced'>(uiMode);
  const [focusedUI,  setFocusedUI]  = useState<'simple' | 'advanced' | null>(uiMode);
const [countdown, setCountdown] = useState(() => APP_CONFIG.UI_SELECTION_COUNTDOWN);
  const TOTAL = APP_CONFIG.UI_SELECTION_COUNTDOWN;

  // ── Animations ──
  const masterFade  = useRef(new Animated.Value(0)).current;
  const titleSlide  = useRef(new Animated.Value(-36)).current;
  const card1Slide  = useRef(new Animated.Value(50)).current;
  const card2Slide  = useRef(new Animated.Value(50)).current;
  const bottomSlide = useRef(new Animated.Value(36)).current;
  const iconBounce1 = useRef(new Animated.Value(0)).current;
  const iconBounce2 = useRef(new Animated.Value(0)).current;
  const card1Scale  = useRef(new Animated.Value(1)).current;
  const card2Scale  = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(masterFade, { toValue: 1, duration: 450, useNativeDriver: true }),
      Animated.spring(titleSlide, { toValue: 0, tension: 80, friction: 10, useNativeDriver: true }),
      Animated.sequence([Animated.delay(140), Animated.spring(card1Slide, { toValue: 0, tension: 70, friction: 10, useNativeDriver: true })]),
      Animated.sequence([Animated.delay(230), Animated.spring(card2Slide, { toValue: 0, tension: 70, friction: 10, useNativeDriver: true })]),
      Animated.sequence([Animated.delay(360), Animated.spring(bottomSlide, { toValue: 0, tension: 70, friction: 10, useNativeDriver: true })]),
    ]).start(() => {
      card1Ref.current?.focus();   // ← only this line added
    });

    const bounceLoop = (anim: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(anim, { toValue: -10, duration: 340, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(anim, { toValue: 0,   duration: 300, easing: Easing.bounce,           useNativeDriver: true }),
          Animated.delay(2000),
        ])
      ).start();

    bounceLoop(iconBounce1, 700);
    bounceLoop(iconBounce2, 1200);
  }, []);

 useEffect(() => {
  const interval = setInterval(() => {
    setCountdown(prev => {
      if (prev <= 1) {
        clearInterval(interval);

        // navigate AFTER state hits 0
        setTimeout(() => {
          handleNavigate();
        }, 0);

        return 0;
      }
      return prev - 1;
    });
  }, 1000);

  return () => clearInterval(interval);
}, []);

  const handleNavigate = async () => {
    await setUIMode(selectedUI);
    selectedUI === 'simple' ? navigation.replace('SimpleUI', {}) : navigation.replace('AdvancedUI');
  };

  const popCard = (scale: Animated.Value) =>
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.94, duration: 80, useNativeDriver: true }),
      Animated.spring(scale,  { toValue: 1,    tension: 220, friction: 7, useNativeDriver: true }),
    ]).start();

  const handleSelect = (mode: 'simple' | 'advanced') => {
    setSelectedUI(mode);
    setFocusedUI(mode);
    setCountdown(APP_CONFIG.UI_SELECTION_COUNTDOWN);
    popCard(mode === 'simple' ? card1Scale : card2Scale);
  };

  // ── Responsive token table ─────────────────────────────────────────────────
  //   isLandPhone  = landscape phone (most constrained on HEIGHT)
  //   isPortPhone  = portrait phone  (most constrained on WIDTH)
  //   otherwise    = tablet / TV

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
    // portrait-mode gap between card1 and VS divider
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

  return (
    <Animated.View style={[styles.root, { opacity: masterFade }]}>

      {/* ── BG dots ── */}
      <View style={styles.bgGrid} pointerEvents="none">
        {Array.from({ length: 6 }).map((_, r) =>
          Array.from({ length: 10 }).map((__, c) => (
            <View key={`${r}-${c}`} style={[styles.bgDot, { top: r * 80 + 20, left: c * 80 + 16 }]} />
          ))
        )}
      </View>

      {/* ── Stars (not in landscape phone — no room) ── */}
      {!isLandPhone && (
        <>
          <FloatingStar size={isPortPhone ? 14 : 24} color="#FFD700" top="6%"  left="4%"  delay={0}   />
          <FloatingStar size={isPortPhone ? 11 : 17} color="#00F5FF" top="9%"  right="5%" delay={500} />
          <FloatingStar size={isPortPhone ? 12 : 19} color="#FF4757" top="78%" left="3%"  delay={900} />
          <FloatingStar size={isPortPhone ? 9  : 13} color="#A29BFE" top="75%" right="4%" delay={300} />
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
        <Text style={[styles.title, { fontSize: R.titleFz }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
          Choose Your Experience
        </Text>
        {R.showSub && (
          <Text style={[styles.subtitle, { fontSize: R.subFz, marginTop: R.subMT }]} numberOfLines={1}>
            Pick the interface that feels right for you
          </Text>
        )}
      </Animated.View>

      {/* ═══════ CARDS — flex:1 fills all remaining space ═══════
          ┌─────────────────────────────────────┐
          │  Portrait  │   Landscape             │
          │  (column)  │   (row)                 │
          │  Card 1    │   Card 1 │ VS │ Card 2  │
          │  -- VS --  │                         │
          │  Card 2    │                         │
          └─────────────────────────────────────┘
          Both cards are flex:1 inside a flex parent → share space evenly.
          No minHeight anywhere → can never overflow.
      ══════════════════════════════════════════ */}
      <View style={[
        styles.cardsRow,
        isPortrait ? styles.cardsColumn : styles.cardsRow2,
      ]}>
        {/* ─── Card 1: Simple UI ─── */}
        <Animated.View style={[
          styles.cardWrap,
          isPortrait ? styles.cardWrapPortrait : styles.cardWrapLandscape,
          { transform: [{ translateY: card1Slide }, { scale: card1Scale }] },
          // Portrait: gap below card1 (above VS divider)
          isPortrait && { marginBottom: R.card1MB },
        ]}>
         <TouchableOpacity
  ref={card1Ref}
  focusable
  onPress={() => handleSelect('simple')}
  onFocus={() => setFocusedUI('simple')}
  onBlur={() => setFocusedUI(null)}
  activeOpacity={0.92}
  style={[
    styles.card,
    { paddingVertical: R.cardPadV, paddingHorizontal: R.cardPadH },
    selectedUI === 'simple' && styles.cardSimple,
    focusedUI  === 'simple' && styles.cardFocused,
    focusedUI  === 'simple' && selectedUI !== 'simple' && styles.cardFocusedUnselected,
  ]}
>
            <View style={[styles.cardGlow, { backgroundColor: selectedUI === 'simple' ? 'rgba(0,245,255,0.09)' : focusedUI === 'simple' ? 'rgba(162,155,254,0.07)' : 'rgba(255,255,255,0.025)' }]} />
            {selectedUI === 'simple' && <View style={styles.cornerTag}><Text style={styles.cornerTagTxt}>✓</Text></View>}
            {focusedUI === 'simple' && selectedUI !== 'simple' && (
              <View style={styles.focusIndicator}>
                <Text style={styles.focusIndicatorTxt}>PRESS OK</Text>
              </View>
            )}

            <Animated.View style={{ transform: [{ translateY: iconBounce1 }] }}>
              <View style={[styles.iconCircle, {
                width: R.iconCircleW, height: R.iconCircleW, borderRadius: R.iconCircleW / 2, marginBottom: R.iconMB,
              }, selectedUI === 'simple' && styles.iconSimple, focusedUI === 'simple' && selectedUI !== 'simple' && styles.iconFocused]}>
                <Icon name="television-play" size={R.iconSz} color={selectedUI === 'simple' ? '#00F5FF' : focusedUI === 'simple' ? '#A29BFE' : '#3D4451'} />
              </View>
            </Animated.View>

            <Text style={[styles.cardTitle, { fontSize: R.cardTitleFz }, selectedUI === 'simple' && styles.cardTitleSimple, focusedUI === 'simple' && selectedUI !== 'simple' && styles.cardTitleFocused]} numberOfLines={1}>
              Simple UI
            </Text>
            <Text style={[styles.cardDesc, { fontSize: R.cardDescFz, marginBottom: R.cardDescMB }]} numberOfLines={R.cardDescLine}>
              {R.cardDescTxt('Classic TV • Instant channels • Numeric keypad', 'Classic TV • Keypad')}
            </Text>
            <View style={[styles.stripe, { backgroundColor: selectedUI === 'simple' ? '#00F5FF' : focusedUI === 'simple' ? '#A29BFE' : '#1E2030' }]} />
          </TouchableOpacity>
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

        {/* ─── Card 2: Advanced UI ─── */}
        <Animated.View style={[
          styles.cardWrap,
          isPortrait ? styles.cardWrapPortrait : styles.cardWrapLandscape,
          { transform: [{ translateY: card2Slide }, { scale: card2Scale }] },
        ]}>
          <TouchableOpacity
            focusable
            onPress={() => handleSelect('advanced')}
            onFocus={() => setFocusedUI('advanced')}
            onBlur={() => setFocusedUI(null)}
            activeOpacity={0.92}
            style={[
              styles.card,
              { paddingVertical: R.cardPadV, paddingHorizontal: R.cardPadH },
              selectedUI === 'advanced' && styles.cardAdvanced,
              focusedUI  === 'advanced' && styles.cardFocused,
              focusedUI  === 'advanced' && selectedUI !== 'advanced' && styles.cardFocusedUnselected,
            ]}
          >
            <View style={[styles.cardGlow, { backgroundColor: selectedUI === 'advanced' ? 'rgba(255,215,0,0.08)' : focusedUI === 'advanced' ? 'rgba(162,155,254,0.07)' : 'rgba(255,255,255,0.025)' }]} />
            {selectedUI === 'advanced' && <View style={[styles.cornerTag, { backgroundColor: '#FFD700' }]}><Text style={[styles.cornerTagTxt, { color: '#0D0D1A' }]}>✓</Text></View>}
            {focusedUI === 'advanced' && selectedUI !== 'advanced' && (
              <View style={styles.focusIndicator}>
                <Text style={styles.focusIndicatorTxt}>PRESS OK</Text>
              </View>
            )}

            <Animated.View style={{ transform: [{ translateY: iconBounce2 }] }}>
              <View style={[styles.iconCircle, {
                width: R.iconCircleW, height: R.iconCircleW, borderRadius: R.iconCircleW / 2, marginBottom: R.iconMB,
              }, selectedUI === 'advanced' && styles.iconAdvanced, focusedUI === 'advanced' && selectedUI !== 'advanced' && styles.iconFocused]}>
                <Icon name="view-grid" size={R.iconSz} color={selectedUI === 'advanced' ? '#FFD700' : focusedUI === 'advanced' ? '#A29BFE' : '#3D4451'} />
              </View>
            </Animated.View>

            <Text style={[styles.cardTitle, { fontSize: R.cardTitleFz }, selectedUI === 'advanced' && styles.cardTitleAdv, focusedUI === 'advanced' && selectedUI !== 'advanced' && styles.cardTitleFocused]} numberOfLines={1}>
              Advanced UI
            </Text>
            <Text style={[styles.cardDesc, { fontSize: R.cardDescFz, marginBottom: R.cardDescMB }]} numberOfLines={R.cardDescLine}>
              {R.cardDescTxt('Visual grid • Thumbnails • Smart discovery', 'Grid view • Thumbnails')}
            </Text>
            <View style={[styles.stripe, { backgroundColor: selectedUI === 'advanced' ? '#FFD700' : focusedUI === 'advanced' ? '#A29BFE' : '#1E2030' }]} />
          </TouchableOpacity>
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
            <Text style={{ color: selectedUI === 'simple' ? '#00F5FF' : '#FFD700', fontFamily: FF.black }}>
              {selectedUI === 'simple' ? 'Simple' : 'Advanced'} UI
            </Text>
          </Text>
          {R.showHint && (
            <Text style={[styles.hintText, { fontSize: R.hintFz }]}>Tap a card to switch</Text>
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

// ─── Font family aliases ──────────────────────────────────────────────────────
const FF = {
  black:     Platform.OS === 'android' ? 'sans-serif-black'     : 'AvenirNext-Heavy',
  medium:    Platform.OS === 'android' ? 'sans-serif-medium'    : 'AvenirNext-Medium',
  condensed: Platform.OS === 'android' ? 'sans-serif-condensed' : 'AvenirNext-Regular',
  light:     Platform.OS === 'android' ? 'sans-serif-light'     : 'AvenirNext-Regular',
};

const styles = StyleSheet.create({
  // ─── Root — flex column: header | cards(flex:1) | bottom ─────────────────
  root: {
    flex: 1,
    backgroundColor: '#0D0D1A',
    overflow: 'hidden',
  },

  // ── Background ──
  bgGrid: { ...StyleSheet.absoluteFillObject },
  bgDot:  { position: 'absolute', width: 3, height: 3, borderRadius: 1.5, backgroundColor: '#fff', opacity: 0.05 },

  // ── Header — auto-height, no fixed padding here (set via inline R.*) ──
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

  // ── Cards row — THE CRITICAL SECTION ─────────────────────────────────────
  //   flex:1 makes it expand to fill all space between header and bottom bar.
  //   No height, no minHeight — children self-size via their own flex:1.
  cardsRow: {
    flex: 1,
    paddingHorizontal: 6,
  },
  cardsColumn: {     // portrait
    flexDirection: 'column',
    alignItems: 'stretch',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  cardsRow2: {       // landscape
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'center',
    paddingVertical: 6,
  },

  // ── Card wrappers — flex:1 so they share the parent space evenly ──
  cardWrap: {
    flex: 1,          // each card wrapper takes equal share of cardsRow
  },
  cardWrapPortrait: {
    alignSelf: 'stretch',   // full width in column mode
    marginHorizontal: 14,
  },
  cardWrapLandscape: {
    alignSelf: 'stretch',   // full height in row mode
    marginHorizontal: 8,
  },

  // ── Card — also flex:1 so it fills its Animated.View wrapper ──
  card: {
    flex: 1,          // fills the cardWrap → no fixed height needed anywhere
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
  cardSimple: {
    borderColor: '#00F5FF',
    backgroundColor: '#0C1E25',
    shadowColor: '#00F5FF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
    elevation: 14,
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
  borderColor: '#ff0000',
  borderWidth: 3.5,
  shadowColor: '#ff0000',
  shadowOpacity: 0.55,
  shadowRadius: 18,
  elevation: 18,
},
  cardFocusedUnselected: {
    backgroundColor: '#13122A',
  },

  // Focus "PRESS OK" pill — top-left corner, only on unfocused+unselected
  focusIndicator: {
    position: 'absolute',
    top: 10,
    left: 10,
    backgroundColor: 'rgba(162,155,254,0.18)',
    borderWidth: 1.2,
    borderColor: '#A29BFE',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  focusIndicatorTxt: {
    fontFamily: FF.black,
    fontWeight: '900',
    fontSize: 9,
    color: '#A29BFE',
    letterSpacing: 1.8,
  },

  cardGlow: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 15,
  },

  // Corner check badge
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

  // Icon circle — w/h/radius set inline via R
  iconCircle: {
    backgroundColor: '#1A1A2E',
    borderWidth: 2,
    borderColor: '#2C2C42',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconSimple:   { backgroundColor: 'rgba(0,245,255,0.08)',  borderColor: '#00F5FF' },
  iconAdvanced: { backgroundColor: 'rgba(255,215,0,0.08)', borderColor: '#FFD700' },
  iconFocused:  { backgroundColor: 'rgba(162,155,254,0.10)', borderColor: '#A29BFE' },

  cardTitle: {
    fontFamily: FF.black,
    fontWeight: '900',
    color: '#3D4451',
    textAlign: 'center',
    letterSpacing: 0.4,
    marginBottom: 5,
  },
  cardTitleSimple:  { color: '#00F5FF' },
  cardTitleAdv:     { color: '#FFD700' },
  cardTitleFocused: { color: '#A29BFE' },

  cardDesc: {
    fontFamily: FF.medium,
    fontWeight: '500',
    color: '#5A6278',
    textAlign: 'center',
    lineHeight: 17,
    letterSpacing: 0.1,
    maxWidth: 230,
  },
  stripe: {
    height: 3,
    width: '52%',
    borderRadius: 2,
  },

  // ── VS Dividers ───────────────────────────────────────────────────────────
  // Portrait: horizontal bar between the two stacked cards
  vsDivH: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 28,
  },
  vsDivLineH: { flex: 1, height: 1.5, backgroundColor: '#1A1A2E' },

  // Landscape: vertical bar between the two side-by-side cards
  vsDivV: {
    flexDirection: 'column',
    alignItems: 'center',
    alignSelf: 'stretch',   // fills full height of the row
    width: 38,
  },
  vsDivLineV: { flex: 1, width: 1.5, backgroundColor: '#1A1A2E' },

  // Shared bubble (size set inline via R)
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

  // ── Bottom Bar ────────────────────────────────────────────────────────────
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