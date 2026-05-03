import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  Platform,
  Dimensions,
} from 'react-native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../../types/navigation';
import { checkForOTAUpdate } from '../../services/OTAUpdateService';


type SplashScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Splash'>;
interface Props { navigation: SplashScreenNavigationProp; }

const { width: SW, height: SH } = Dimensions.get('window');

const FF = {
  black:  Platform.OS === 'android' ? 'sans-serif-black'  : 'AvenirNext-Heavy',
  bold:   Platform.OS === 'android' ? 'sans-serif-medium' : 'AvenirNext-DemiBold',
  medium: Platform.OS === 'android' ? 'sans-serif-medium' : 'AvenirNext-Medium',
  mono:   Platform.OS === 'android' ? 'monospace'         : 'Courier New',
};

// ─── Star field (static + twinkle) ───────────────────────────────────────────
const STARS = Array.from({ length: 110 }, (_, i) => ({
  x: Math.abs(Math.sin(i * 97.3 + 17) * SW),
  y: Math.abs(Math.cos(i * 251.9 + 43) * SH),
  r: 0.6 + (i % 5) * 0.5,
  o: 0.08 + (i % 6) * 0.08,
  twinkle: i % 4 === 0,
  color: ['#FFFFFF', '#B8D4FF', '#FFE8CC', '#D8CCFF', '#CCFFF0'][i % 5],
}));

// ─── Shooting Star ────────────────────────────────────────────────────────────
const ShootingStar: React.FC<{ anim: Animated.Value; y: number; angle: number }> = ({ anim, y, angle }) => {
  const x       = anim.interpolate({ inputRange: [0, 1], outputRange: [-220, SW + 220] });
  const opacity = anim.interpolate({ inputRange: [0, 0.05, 0.75, 1], outputRange: [0, 1, 0.8, 0] });
  return (
    <Animated.View style={{
      position: 'absolute', top: y, opacity,
      transform: [{ translateX: x }, { rotate: `${angle}deg` }],
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {[1, 0.65, 0.38, 0.2, 0.08].map((op, i) => (
          <View key={i} style={{
            width: i === 0 ? 10 : 22 - i * 4,
            height: i === 0 ? 2.5 : 1.2,
            borderRadius: 2,
            backgroundColor: `rgba(200,230,255,${op})`,
            marginLeft: i === 0 ? 0 : -1,
          }} />
        ))}
      </View>
    </Animated.View>
  );
};

// ─── Broadcast Ring ───────────────────────────────────────────────────────────
const BroadcastRing: React.FC<{
  scale: Animated.Value;
  opacity: Animated.Value;
  color: string;
  size: number;
}> = ({ scale, opacity, color, size }) => (
  <Animated.View style={{
    position: 'absolute',
    width: size, height: size, borderRadius: size / 2,
    borderWidth: 1, borderColor: color,
    transform: [{ scale }], opacity,
    shadowColor: color, shadowRadius: 12, shadowOpacity: 0.6,
  }} />
);

// ─── Floating Particle ────────────────────────────────────────────────────────
const Particle: React.FC<{
  anim: Animated.Value; x: number; y: number; color: string; size: number;
}> = ({ anim, x, y, color, size }) => {
  const ty  = anim.interpolate({ inputRange: [0, 1], outputRange: [0, -28] });
  const op  = anim.interpolate({ inputRange: [0, 0.3, 0.7, 1], outputRange: [0, 0.7, 0.7, 0] });
  const sc  = anim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.4, 1, 0.6] });
  return (
    <Animated.View style={{
      position: 'absolute', left: x, top: y,
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: color,
      opacity: op, transform: [{ translateY: ty }, { scale: sc }],
      shadowColor: color, shadowRadius: size * 1.4, shadowOpacity: 1,
    }} />
  );
};

// ─── Sleek Rocket (nose RIGHT, flame LEFT, drifts) ───────────────────────────
const SleekRocket: React.FC<{
  posX: Animated.Value;
  posY: Animated.Value;
  tilt: Animated.Value;
  flameScale: Animated.Value;
  flameOpacity: Animated.Value;
}> = ({ posX, posY, tilt, flameScale, flameOpacity }) => {

  const rotDeg = tilt.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: ['-12deg', '0deg', '12deg'],
  });

  const fLen = (lo: number, hi: number) =>
    flameScale.interpolate({ inputRange: [0.6, 1.6], outputRange: [lo, hi] });

  const flameGlow = flameScale.interpolate({
    inputRange: [0.6, 1.6], outputRange: [0.3, 0.9],
  });

  return (
    <Animated.View style={[
      styles.rocketOuter,
      { transform: [{ translateX: posX }, { translateY: posY }, { rotate: rotDeg }] },
    ]}>
      <View style={styles.rocketAssembly}>

        {/* ── EXHAUST PLUME ── */}
        <Animated.View style={[styles.exhaustWrap, { opacity: flameOpacity }]}>
          {/* Outer glow blob */}
          <Animated.View style={[styles.exhaustGlow, { opacity: flameGlow, transform: [{ scale: flameScale }] }]} />

          {/* Main exhaust streams */}
          <Animated.View style={[styles.exhaustStream, styles.exhaustTop, { width: fLen(38, 64) }]} />
          <Animated.View style={[styles.exhaustStream, styles.exhaustMid, { width: fLen(52, 82) }]} />
          <Animated.View style={[styles.exhaustStream, styles.exhaustBot, { width: fLen(34, 58) }]} />

          {/* Hot core */}
          <Animated.View style={[styles.exhaustCore, { width: fLen(18, 32) }]} />
          <Animated.View style={[styles.exhaustInner, { width: fLen(8, 18) }]} />
        </Animated.View>

        {/* ── ENGINE BELL ── */}
        <View style={styles.engineBell}>
          <View style={styles.engineBellInner} />
        </View>

        {/* ── BODY ── */}
        <View style={styles.rocketBody}>
          {/* Metallic sheen */}
          <View style={styles.bodySheenTop} />
          <View style={styles.bodySheenBot} />
          {/* Accent stripe */}
          <View style={styles.bodyStripe} />
          {/* Window */}
          <View style={styles.window}>
            <View style={styles.windowGlass}>
              <View style={styles.windowShine1} />
              <View style={styles.windowShine2} />
            </View>
          </View>
          {/* Fins */}
          <View style={styles.finTop} />
          <View style={styles.finBot} />
        </View>

        {/* ── NOSE CONE ── */}
        <View style={styles.noseConeWrap}>
          <View style={styles.noseCone} />
          <View style={styles.noseConeSheen} />
        </View>

      </View>
    </Animated.View>
  );
};

// ─── Main Screen ──────────────────────────────────────────────────────────────
const SplashScreen: React.FC<Props> = ({ navigation }) => {

  // Logo / text
  const logoScale    = useRef(new Animated.Value(0.08)).current;
  const logoOpacity  = useRef(new Animated.Value(0)).current;
  const textOpacity  = useRef(new Animated.Value(0)).current;
  const tagOpacity   = useRef(new Animated.Value(0)).current;
  const shimmerX     = useRef(new Animated.Value(-300)).current;
  const loadingW     = useRef(new Animated.Value(0)).current;

  // Broadcast rings
  const r1S = useRef(new Animated.Value(0.3)).current;
  const r1O = useRef(new Animated.Value(0.9)).current;
  const r2S = useRef(new Animated.Value(0.3)).current;
  const r2O = useRef(new Animated.Value(0.9)).current;
  const r3S = useRef(new Animated.Value(0.3)).current;
  const r3O = useRef(new Animated.Value(0.9)).current;

  // Logo glow
  const glowPulse = useRef(new Animated.Value(1)).current;

  // Stars
  const twinkleStars = STARS.filter(s => s.twinkle);
  const twinkleRefs  = useRef(twinkleStars.map(() => new Animated.Value(1))).current;

  // Shooting stars
  const shoot1 = useRef(new Animated.Value(0)).current;
  const shoot2 = useRef(new Animated.Value(0)).current;
  const shoot3 = useRef(new Animated.Value(0)).current;

  // Particles
  const particleAnims = useRef(Array.from({ length: 10 }, () => new Animated.Value(0))).current;

  // Rocket
  const rocketX      = useRef(new Animated.Value(-SW * 0.28)).current;
  const rocketY      = useRef(new Animated.Value(0)).current;
  const rocketTilt   = useRef(new Animated.Value(0)).current;
  const flameScale   = useRef(new Animated.Value(1)).current;
  const flameOpacity = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    // ── Logo entrance ──
    Animated.sequence([
      Animated.delay(180),
      Animated.parallel([
        Animated.spring(logoScale, {
          toValue: 1.06, tension: 60, friction: 6, useNativeDriver: true,
        }),
        Animated.timing(logoOpacity, {
          toValue: 1, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: true,
        }),
      ]),
      Animated.spring(logoScale, {
        toValue: 1, tension: 180, friction: 12, useNativeDriver: true,
      }),
      Animated.timing(textOpacity, {
        toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
      Animated.timing(tagOpacity, {
        toValue: 1, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
    ]).start();

    // ── Loading bar ──
    Animated.timing(loadingW, {
      toValue: 1, duration: 3400, easing: Easing.out(Easing.cubic), useNativeDriver: false,
    }).start();

    // ── Shimmer ──
    Animated.loop(Animated.sequence([
      Animated.timing(shimmerX, {
        toValue: 320, duration: 1800, easing: Easing.linear, useNativeDriver: true,
      }),
      Animated.delay(500),
      Animated.timing(shimmerX, { toValue: -300, duration: 0, useNativeDriver: true }),
      Animated.delay(400),
    ])).start();

    // ── Glow pulse ──
    Animated.loop(Animated.sequence([
      Animated.timing(glowPulse, {
        toValue: 1.22, duration: 1100, easing: Easing.inOut(Easing.sin), useNativeDriver: true,
      }),
      Animated.timing(glowPulse, {
        toValue: 1.0, duration: 1100, easing: Easing.inOut(Easing.sin), useNativeDriver: true,
      }),
    ])).start();

    // ── Broadcast rings ──
    const ring = (sV: Animated.Value, oV: Animated.Value, delay: number) => {
      const run = () => {
        sV.setValue(0.3); oV.setValue(0.8);
        Animated.parallel([
          Animated.timing(sV, {
            toValue: 3.5, duration: 2200, easing: Easing.out(Easing.cubic), useNativeDriver: true,
          }),
          Animated.timing(oV, {
            toValue: 0, duration: 2200, easing: Easing.out(Easing.cubic), useNativeDriver: true,
          }),
        ]).start(() => setTimeout(run, delay));
      };
      setTimeout(run, delay);
    };
    ring(r1S, r1O, 0);
    ring(r2S, r2O, 700);
    ring(r3S, r3O, 1400);

    // ── Twinkle ──
    twinkleRefs.forEach((v, i) => {
      Animated.loop(Animated.sequence([
        Animated.delay(i * 280 + Math.random() * 400),
        Animated.timing(v, { toValue: 0.05, duration: 350, useNativeDriver: true }),
        Animated.timing(v, { toValue: 1,    duration: 350, useNativeDriver: true }),
        Animated.delay(200),
      ])).start();
    });

    // ── Shooting stars ──
    const shoot = (v: Animated.Value, delay: number) => {
      setTimeout(() => {
        Animated.loop(Animated.sequence([
          Animated.timing(v, {
            toValue: 1, duration: 680, easing: Easing.inOut(Easing.quad), useNativeDriver: true,
          }),
          Animated.delay(3200),
          Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true }),
          Animated.delay(900),
        ])).start();
      }, delay);
    };
    shoot(shoot1, 600);
    shoot(shoot2, 2000);
    shoot(shoot3, 3500);

    // ── Particles ──
    particleAnims.forEach((v, i) => {
      const loop = () => {
        v.setValue(0);
        Animated.timing(v, {
          toValue: 1, duration: 2400 + i * 300, easing: Easing.inOut(Easing.sin), useNativeDriver: true,
        }).start(() => setTimeout(loop, i * 180));
      };
      setTimeout(loop, i * 320);
    });

    // ── Flame flicker ──
    Animated.loop(Animated.sequence([
      Animated.timing(flameScale, {
        toValue: 1.6, duration: 75, easing: Easing.inOut(Easing.quad), useNativeDriver: true,
      }),
      Animated.timing(flameScale, {
        toValue: 0.65, duration: 75, easing: Easing.inOut(Easing.quad), useNativeDriver: true,
      }),
      Animated.timing(flameScale, { toValue: 1.35, duration: 55, useNativeDriver: true }),
      Animated.timing(flameScale, { toValue: 0.82, duration: 55, useNativeDriver: true }),
    ])).start();

    Animated.loop(Animated.sequence([
      Animated.timing(flameOpacity, { toValue: 1,   duration: 90, useNativeDriver: true }),
      Animated.timing(flameOpacity, { toValue: 0.5, duration: 90, useNativeDriver: true }),
    ])).start();

    // ── Rocket drift — gentle sinusoidal path ──
    const drift = () => {
      rocketX.setValue(-SW * 0.25);
      rocketY.setValue(0);
      rocketTilt.setValue(0);

      const totalDur = 4200;
      const steps    = 6;
      const stepDur  = totalDur / steps;

      const tiltSeq = [
        { dy: -14, tilt: -0.28 },
        { dy:   8, tilt:  0.18 },
        { dy: -18, tilt: -0.22 },
        { dy:  12, tilt:  0.24 },
        { dy:  -8, tilt: -0.16 },
        { dy:   6, tilt:  0.10 },
      ];

      Animated.parallel([
        Animated.timing(rocketX, {
          toValue: SW * 1.25,
          duration: totalDur,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.sequence(
          tiltSeq.map(s =>
            Animated.parallel([
              Animated.timing(rocketY, {
                toValue: s.dy, duration: stepDur,
                easing: Easing.inOut(Easing.sin), useNativeDriver: true,
              }),
              Animated.timing(rocketTilt, {
                toValue: s.tilt, duration: stepDur * 0.5,
                easing: Easing.out(Easing.quad), useNativeDriver: true,
              }),
            ])
          )
        ),
      ]).start(() => setTimeout(drift, 180));
    };
    setTimeout(drift, 800);

    // ── Navigate ──
   // ─── REPLACE with this block ─────────────────────────────────────────
let cancelled = false;

// Run OTA check in parallel with the splash animations.
// Both must finish before we navigate — splash always shows at least 3800 ms.
Promise.all([
  new Promise<void>(resolve => setTimeout(resolve, 3800)),
  checkForOTAUpdate(),
]).then(([, otaResult]) => {
  if (cancelled) return;

  if (otaResult.updateAvailable) {
    // storePendingOTA() was already called inside checkForOTAUpdate()
    navigation.reset({ index: 0, routes: [{ name: 'OTAUpdate' }] });
  } else {
    navigation.reset({ index: 0, routes: [{ name: 'Selection' }] });
  }
});

return () => { cancelled = true; };
// ─────────────────────────────────────────────────────────────────────
  }, []);

  // ── Particle positions ──
  const PARTICLES = [
    { x: SW * 0.06, y: SH * 0.13, color: '#00D4FF', size: 5 },
    { x: SW * 0.88, y: SH * 0.10, color: '#FF3CAC', size: 4 },
    { x: SW * 0.04, y: SH * 0.44, color: '#FFD700', size: 6 },
    { x: SW * 0.92, y: SH * 0.48, color: '#00FFA3', size: 4 },
    { x: SW * 0.15, y: SH * 0.78, color: '#A78BFA', size: 5 },
    { x: SW * 0.80, y: SH * 0.82, color: '#00D4FF', size: 4 },
    { x: SW * 0.42, y: SH * 0.06, color: '#FF3CAC', size: 3 },
    { x: SW * 0.60, y: SH * 0.94, color: '#FFD700', size: 4 },
    { x: SW * 0.72, y: SH * 0.20, color: '#00FFA3', size: 3 },
    { x: SW * 0.25, y: SH * 0.88, color: '#A78BFA', size: 5 },
  ];

  const logoGlowOp = glowPulse.interpolate({
    inputRange: [1, 1.22], outputRange: [0.5, 1],
  });

  return (
    <View style={styles.root}>
      {/* Background layers */}
      <View style={styles.bgBase} />
      <View style={styles.bgGrad1} />
      <View style={styles.bgGrad2} />
      <View style={styles.bgGrad3} />
      <View style={styles.bgGrad4} />

      {/* Static stars */}
      {STARS.map((s, i) => (
        <View key={`s${i}`} style={[styles.star, {
          left: s.x, top: s.y,
          width: s.r, height: s.r,
          borderRadius: s.r / 2,
          opacity: s.o,
          backgroundColor: s.color,
        }]} />
      ))}

      {/* Twinkle stars */}
      {twinkleStars.map((s, i) => (
        <Animated.View key={`tw${i}`} style={[styles.star, {
          left: s.x, top: s.y,
          width: s.r + 2, height: s.r + 2,
          borderRadius: (s.r + 2) / 2,
          opacity: twinkleRefs[i],
          backgroundColor: s.color,
          shadowColor: s.color, shadowRadius: 6, shadowOpacity: 1,
        }]} />
      ))}

      {/* Particles */}
      {PARTICLES.map((p, i) => (
        <Particle key={i} anim={particleAnims[i]} x={p.x} y={p.y} color={p.color} size={p.size} />
      ))}

      {/* Shooting stars */}
      <ShootingStar anim={shoot1} y={SH * 0.06} angle={-8}  />
      <ShootingStar anim={shoot2} y={SH * 0.18} angle={-11} />
      <ShootingStar anim={shoot3} y={SH * 0.30} angle={-7}  />

      {/* Center content */}
      <View style={styles.center}>

        {/* Broadcast rings behind logo */}
        <BroadcastRing scale={r1S} opacity={r1O} color="rgba(0,212,255,0.55)"  size={200} />
        <BroadcastRing scale={r2S} opacity={r2O} color="rgba(255,60,172,0.40)" size={160} />
        <BroadcastRing scale={r3S} opacity={r3O} color="rgba(255,215,0,0.30)"  size={120} />

        {/* Logo mark */}
        <Animated.View style={[
          styles.logoWrap,
          { opacity: logoOpacity, transform: [{ scale: logoScale }] },
        ]}>
          <Animated.View style={[styles.logoGlowOuter, {
            opacity: logoGlowOp, transform: [{ scale: glowPulse }],
          }]} />
          <Animated.View style={[styles.logoGlowMid, { opacity: logoGlowOp }]} />

          {/* Signal icon */}
          <View style={styles.logoIcon}>
            <View style={[styles.signalBar, styles.sb1]} />
            <View style={[styles.signalBar, styles.sb2]} />
            <View style={[styles.signalBar, styles.sb3]} />
            <View style={[styles.signalBar, styles.sb4]} />
            <View style={styles.signalDot} />
          </View>
        </Animated.View>

        {/* App name */}
        <Animated.View style={[styles.nameBlock, { opacity: textOpacity }]}>
          <View style={styles.nameRow}>
            <Text style={styles.nameMain}>LIVE</Text>
            <View style={styles.nameBadge}>
              <Text style={styles.nameBadgeText}>TV</Text>
            </View>
          </View>
          <View style={styles.shimmerClip}>
            <Animated.View style={[
              styles.shimmerBar,
              { transform: [{ translateX: shimmerX }] },
            ]} />
          </View>
        </Animated.View>

        {/* Tagline */}
        <Animated.View style={[styles.taglineRow, { opacity: tagOpacity }]}>
          <View style={styles.taglineLine} />
          <Text style={styles.tagline}>Stream Anything · Anywhere</Text>
          <View style={styles.taglineLine} />
        </Animated.View>

        {/* Loading bar */}
        <Animated.View style={[styles.loaderWrap, { opacity: tagOpacity }]}>
          <View style={styles.loaderBg}>
            <Animated.View style={[styles.loaderFill, {
              width: loadingW.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
            }]}>
              <View style={styles.loaderShimmer} />
            </Animated.View>
            <Animated.View style={[styles.loaderTip, {
              left: loadingW.interpolate({ inputRange: [0, 1], outputRange: ['0%', '96%'] }),
            }]} />
          </View>
          <Text style={styles.loaderLabel}>Initialising stream...</Text>
        </Animated.View>

      </View>

      {/* Rocket row */}
      <View style={styles.rocketRow}>
        <SleekRocket
          posX={rocketX}
          posY={rocketY}
          tilt={rocketTilt}
          flameScale={flameScale}
          flameOpacity={flameOpacity}
        />
      </View>
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1, backgroundColor: '#03030E',
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },

  // Backgrounds
  bgBase:  { position: 'absolute', width: SW, height: SH, backgroundColor: '#03030E' },
  bgGrad1: {
    position: 'absolute', width: SW * 1.6, height: SW * 1.6,
    borderRadius: SW * 0.8, top: -SW * 0.55, left: -SW * 0.35,
    backgroundColor: 'rgba(30,0,80,0.32)',
  },
  bgGrad2: {
    position: 'absolute', width: SW * 1.3, height: SW * 1.3,
    borderRadius: SW * 0.65, bottom: -SW * 0.45, right: -SW * 0.28,
    backgroundColor: 'rgba(0,40,100,0.28)',
  },
  bgGrad3: {
    position: 'absolute', width: 320, height: 320, borderRadius: 160,
    top: SH * 0.28, left: SW * 0.02, backgroundColor: 'rgba(0,160,200,0.055)',
  },
  bgGrad4: {
    position: 'absolute', width: 240, height: 240, borderRadius: 120,
    bottom: SH * 0.12, right: SW * 0.04, backgroundColor: 'rgba(180,0,120,0.045)',
  },

  star: { position: 'absolute' },

  // Center
  center: { alignItems: 'center', justifyContent: 'center' },

  // Logo mark
  logoWrap: { alignItems: 'center', justifyContent: 'center', marginBottom: 28 },
  logoGlowOuter: {
    position: 'absolute', width: 130, height: 130, borderRadius: 65,
    backgroundColor: 'rgba(0,212,255,0.08)',
    borderWidth: 1, borderColor: 'rgba(0,212,255,0.18)',
    shadowColor: '#00D4FF', shadowRadius: 40, shadowOpacity: 1,
  },
  logoGlowMid: {
    position: 'absolute', width: 88, height: 88, borderRadius: 44,
    backgroundColor: 'rgba(0,212,255,0.06)',
    borderWidth: 0.5, borderColor: 'rgba(255,60,172,0.22)',
  },
  logoIcon: {
    width: 64, height: 64, borderRadius: 18,
    backgroundColor: 'rgba(0,212,255,0.12)',
    borderWidth: 1.5, borderColor: 'rgba(0,212,255,0.45)',
    alignItems: 'flex-end', justifyContent: 'flex-end',
    paddingRight: 10, paddingBottom: 10,
    shadowColor: '#00D4FF', shadowRadius: 20, shadowOpacity: 0.9,
  },
  signalBar: {
    position: 'absolute', bottom: 8, borderRadius: 2,
    backgroundColor: '#00D4FF',
    shadowColor: '#00D4FF', shadowRadius: 4, shadowOpacity: 0.8,
  },
  sb1: { width: 4, height: 8,  right: 36 },
  sb2: { width: 4, height: 14, right: 28 },
  sb3: { width: 4, height: 20, right: 20 },
  sb4: { width: 4, height: 28, right: 12 },
  signalDot: {
    position: 'absolute', bottom: 8, right: 44,
    width: 5, height: 5, borderRadius: 2.5,
    backgroundColor: '#FF3CAC',
    shadowColor: '#FF3CAC', shadowRadius: 5, shadowOpacity: 1,
  },

  // Name
  nameBlock: { alignItems: 'center', overflow: 'hidden' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  nameMain: {
    fontFamily: FF.black, fontWeight: '900',
    fontSize: 62, letterSpacing: 14, color: '#FFFFFF',
    textShadowColor: 'rgba(0,212,255,0.85)',
    textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 28,
  },
  nameBadge: {
    backgroundColor: '#00D4FF', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 6,
    shadowColor: '#00D4FF', shadowRadius: 20, shadowOpacity: 1, elevation: 16,
  },
  nameBadgeText: {
    fontFamily: FF.black, fontWeight: '900',
    fontSize: 28, color: '#03030E', letterSpacing: 5,
  },
  shimmerClip: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, overflow: 'hidden' },
  shimmerBar: {
    position: 'absolute', top: 0, bottom: 0, width: 120,
    backgroundColor: 'rgba(255,255,255,0.14)',
    transform: [{ skewX: '-18deg' }],
  },

  // Tagline
  taglineRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  taglineLine: { width: 28, height: 0.8, backgroundColor: 'rgba(0,212,255,0.4)' },
  tagline: {
    fontFamily: FF.medium, fontSize: 11.5,
    color: 'rgba(180,210,230,0.55)', letterSpacing: 2.8,
  },

  // Loader
  loaderWrap: { marginTop: 28, alignItems: 'center' },
  loaderBg: {
    width: 220, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(0,212,255,0.10)', overflow: 'visible',
  },
  loaderFill: {
    height: '100%', borderRadius: 2,
    backgroundColor: '#00D4FF',
    shadowColor: '#00D4FF', shadowRadius: 8, shadowOpacity: 1,
    overflow: 'hidden',
  },
  loaderShimmer: {
    position: 'absolute', top: 0, right: 0, bottom: 0, width: 30,
    backgroundColor: 'rgba(255,255,255,0.35)', borderRadius: 2,
  },
  loaderTip: {
    position: 'absolute', top: -5, width: 14, height: 14, borderRadius: 7,
    backgroundColor: '#00D4FF',
    shadowColor: '#00D4FF', shadowRadius: 12, shadowOpacity: 1, elevation: 12,
  },
  loaderLabel: {
    marginTop: 10, fontFamily: FF.mono,
    fontSize: 9.5, color: 'rgba(0,212,255,0.45)', letterSpacing: 2.4,
  },

  // ─── Rocket ───────────────────────────────────────────────────────────────
  rocketRow: {
    position: 'absolute', top: SH * 0.71, left: 0,
    width: SW, height: 110, overflow: 'visible',
  },
  rocketOuter: {
    position: 'absolute', top: 16, left: 0,
    overflow: 'visible', flexDirection: 'row', alignItems: 'center',
  },
  rocketAssembly: { flexDirection: 'row', alignItems: 'center' },

  // Exhaust
  exhaustWrap: {
    width: 78, height: 40, justifyContent: 'center',
    overflow: 'visible', marginRight: -10, position: 'relative',
  },
  exhaustGlow: {
    position: 'absolute', left: -14, top: -18,
    width: 80, height: 76, borderRadius: 40,
    backgroundColor: 'rgba(0,160,255,0.09)',
  },
  exhaustStream: {
    position: 'absolute', left: 0, borderRadius: 6,
  },
  exhaustTop: {
    top: 2, height: 9,
    backgroundColor: '#1A6EFF',
    shadowColor: '#00AAFF', shadowRadius: 10, shadowOpacity: 0.8, elevation: 6,
  },
  exhaustMid: {
    top: 12, height: 14, zIndex: 5,
    backgroundColor: '#0055FF',
    shadowColor: '#0099FF', shadowRadius: 18, shadowOpacity: 1, elevation: 12,
  },
  exhaustBot: {
    top: 28, height: 9,
    backgroundColor: '#1A6EFF',
    shadowColor: '#00AAFF', shadowRadius: 10, shadowOpacity: 0.8, elevation: 6,
  },
  exhaustCore: {
    position: 'absolute', top: 15, left: 2, height: 8, borderRadius: 4,
    backgroundColor: '#66CCFF',
    shadowColor: '#AADDFF', shadowRadius: 8, shadowOpacity: 1,
  },
  exhaustInner: {
    position: 'absolute', top: 17, left: 4, height: 4, borderRadius: 2,
    backgroundColor: '#FFFFFF',
    shadowColor: '#FFFFFF', shadowRadius: 5, shadowOpacity: 1,
  },

  // Engine bell
  engineBell: {
    width: 14, height: 26, borderRadius: 5,
    backgroundColor: '#2A3560',
    borderWidth: 1.5, borderColor: '#4466AA',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#3355CC', shadowRadius: 6, shadowOpacity: 0.7,
    marginRight: -2,
  },
  engineBellInner: {
    width: 8, height: 18, borderRadius: 3,
    backgroundColor: '#364070',
  },

  // Body
  rocketBody: {
    width: 82, height: 40,
    backgroundColor: '#E8ECFA',
    borderRadius: 8,
    borderWidth: 1.5, borderColor: '#9AAAD8',
    alignItems: 'center', justifyContent: 'center',
    overflow: 'visible',
    shadowColor: '#4466CC', shadowRadius: 14, shadowOpacity: 0.55, elevation: 14,
  },
  bodySheenTop: {
    position: 'absolute', left: 0, right: 0, top: 0,
    height: 16, borderTopLeftRadius: 8, borderTopRightRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  bodySheenBot: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    height: 10, borderBottomLeftRadius: 8, borderBottomRightRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  bodyStripe: {
    position: 'absolute', left: 20, right: 20,
    top: 0, bottom: 0,
    backgroundColor: '#3B6BFF', opacity: 0.16, borderRadius: 4,
  },
  window: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: '#080F24',
    borderWidth: 2, borderColor: '#6688BB',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#33AAFF', shadowRadius: 8, shadowOpacity: 1, elevation: 9,
  },
  windowGlass: {
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: '#1A44CC',
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  windowShine1: {
    position: 'absolute', top: 1, left: 1,
    width: 5, height: 5, borderRadius: 2.5,
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  windowShine2: {
    position: 'absolute', bottom: 2, right: 1,
    width: 3, height: 3, borderRadius: 1.5,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  finTop: {
    position: 'absolute', top: -16, right: 16,
    width: 0, height: 0,
    borderBottomWidth: 18, borderLeftWidth: 10, borderRightWidth: 10,
    borderBottomColor: '#3B6BFF',
    borderLeftColor: 'transparent', borderRightColor: 'transparent',
  },
  finBot: {
    position: 'absolute', bottom: -16, right: 16,
    width: 0, height: 0,
    borderTopWidth: 18, borderLeftWidth: 10, borderRightWidth: 10,
    borderTopColor: '#3B6BFF',
    borderLeftColor: 'transparent', borderRightColor: 'transparent',
  },

  // Nose cone
  noseConeWrap: {
    width: 34, height: 40,
    justifyContent: 'center', alignItems: 'flex-start',
    overflow: 'visible', marginLeft: -2,
  },
  noseCone: {
    width: 0, height: 0,
    borderTopWidth: 20, borderBottomWidth: 20, borderLeftWidth: 34,
    borderTopColor: 'transparent', borderBottomColor: 'transparent',
    borderLeftColor: '#3B6BFF',
  },
  noseConeSheen: {
    position: 'absolute', left: 4, top: 8,
    width: 5, height: 12, borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.25)',
    transform: [{ rotate: '12deg' }],
  },
});

export default SplashScreen;