// src/screens/ota/OTAUpdateScreen.tsx

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Easing,
  Dimensions,
  Platform,
} from 'react-native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../../types/navigation';
import { consumePendingOTA, OTAProgressEvent } from '../../services/OTAUpdateService';

// ─── Helpers ────────────────────────────────────────────────────────────────
const { width: SW } = Dimensions.get('window');

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const FF = Platform.OS === 'android'
  ? { bold: 'sans-serif-medium', regular: 'sans-serif', mono: 'monospace' }
  : { bold: 'AvenirNext-DemiBold', regular: 'AvenirNext-Regular', mono: 'Courier New' };

// ─── States ──────────────────────────────────────────────────────────────────
type ScreenState = 'idle' | 'downloading' | 'done' | 'error';

// ─── Glow Ring component (matches splash BroadcastRing style) ────────────────
const GlowRing: React.FC<{
  scale: Animated.Value;
  opacity: Animated.Value;
  size: number;
  color: string;
}> = ({ scale, opacity, size, color }) => (
  <Animated.View
    style={{
      position: 'absolute',
      width: size, height: size,
      borderRadius: size / 2,
      borderWidth: 1,
      borderColor: color,
      transform: [{ scale }],
      opacity,
    }}
  />
);

// ─── Main Screen ─────────────────────────────────────────────────────────────
type Props = {
  navigation: StackNavigationProp<RootStackParamList, 'OTAUpdate'>;
};

const OTAUpdateScreen: React.FC<Props> = ({ navigation }) => {
  const otaResult = consumePendingOTA();

  // If somehow we land here without a pending result — go back to selection
  useEffect(() => {
    if (!otaResult?.updateAvailable) {
      navigation.reset({ index: 0, routes: [{ name: 'Selection' }] });
    }
  }, []);

  if (!otaResult?.updateAvailable) return null;

  const { version, bundleSize, applyUpdate } = otaResult;

  // ─── State ────────────────────────────────────────────────────────────────
  const [screenState, setScreenState] = useState<ScreenState>('idle');
  const [progress, setProgress]       = useState(0);
  const [downloaded, setDownloaded]   = useState(0);
  const [totalSize, setTotalSize]     = useState(bundleSize);
  const [errorMsg, setErrorMsg]       = useState('');

  // ─── Animations ───────────────────────────────────────────────────────────
  const progressAnim  = useRef(new Animated.Value(0)).current;
  const fadeIn        = useRef(new Animated.Value(0)).current;
  const iconPulse     = useRef(new Animated.Value(1)).current;
  const doneScale     = useRef(new Animated.Value(0)).current;

  // Ring anims (broadcast rings like splash)
  const r1S = useRef(new Animated.Value(0.3)).current;
  const r1O = useRef(new Animated.Value(0.8)).current;
  const r2S = useRef(new Animated.Value(0.3)).current;
  const r2O = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    // Fade in
    Animated.timing(fadeIn, {
      toValue: 1, duration: 500, easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start();

    // Icon pulse
    Animated.loop(Animated.sequence([
      Animated.timing(iconPulse, { toValue: 1.12, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(iconPulse, { toValue: 1.0,  duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ])).start();

    // Broadcast rings (same pattern as splash)
    const ring = (sV: Animated.Value, oV: Animated.Value, delay: number) => {
      const run = () => {
        sV.setValue(0.3); oV.setValue(0.7);
        Animated.parallel([
          Animated.timing(sV, { toValue: 3.2, duration: 2000, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          Animated.timing(oV, { toValue: 0,   duration: 2000, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        ]).start(() => setTimeout(run, delay));
      };
      setTimeout(run, delay);
    };
    ring(r1S, r1O, 0);
    ring(r2S, r2O, 800);
  }, []);

  // Animate progress bar fill
  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: progress / 100,
      duration: 200,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  }, [progress]);

  // Done animation
  const playDoneAnimation = useCallback(() => {
    Animated.spring(doneScale, {
      toValue: 1, tension: 80, friction: 5, useNativeDriver: true,
    }).start();
  }, []);

  // ─── Start download ───────────────────────────────────────────────────────
  const startUpdate = useCallback(async () => {
    setScreenState('downloading');
    setProgress(0);
    setDownloaded(0);
    setErrorMsg('');

    try {
      await applyUpdate((event: OTAProgressEvent) => {
        setProgress(event.percent);
        setDownloaded(event.bytesWritten);
        // Firestore bundleSize is an estimate — use real contentLength if available
        if (event.contentLength > 0) setTotalSize(event.contentLength);

        if (event.percent >= 100) {
          setScreenState('done');
          playDoneAnimation();
        }
      });
      // applyUpdate() triggers RNRestart.Restart() internally — screen unmounts
    } catch (err: any) {
      setErrorMsg(err?.message ?? 'Download failed. Check your connection.');
      setScreenState('error');
    }
  }, [applyUpdate, playDoneAnimation]);

  // ─── Interpolations ───────────────────────────────────────────────────────
  const barWidth = progressAnim.interpolate({
    inputRange: [0, 1], outputRange: ['0%', '100%'],
  });

  const tipLeft = progressAnim.interpolate({
    inputRange: [0, 1], outputRange: ['0%', '97%'],
  });

  return (
    <View style={styles.root}>
      {/* Background layers — same palette as splash */}
      <View style={styles.bgBase} />
      <View style={styles.bgGrad1} />
      <View style={styles.bgGrad2} />

      <Animated.View style={[styles.content, { opacity: fadeIn }]}>

        {/* ── Icon area with broadcast rings ─────────────────────────────── */}
        <View style={styles.iconArea}>
          <GlowRing scale={r1S} opacity={r1O} size={140} color="rgba(0,212,255,0.5)"  />
          <GlowRing scale={r2S} opacity={r2O} size={110} color="rgba(167,139,250,0.4)" />

          <Animated.View style={[styles.iconCircle, { transform: [{ scale: iconPulse }] }]}>
            {screenState === 'done' ? (
              <Animated.Text style={[styles.iconText, { transform: [{ scale: doneScale }] }]}>
                ✓
              </Animated.Text>
            ) : screenState === 'error' ? (
              <Text style={styles.iconText}>!</Text>
            ) : (
              <Text style={styles.iconText}>⬆</Text>
            )}
          </Animated.View>
        </View>

        {/* ── IDLE ──────────────────────────────────────────────────────── */}
        {screenState === 'idle' && (
          <View style={styles.section}>
            <Text style={styles.title}>Update Available</Text>
            <Text style={styles.subtitle}>
              Version {version} is ready to install
            </Text>

            {/* Size badge */}
            <View style={styles.metaRow}>
              <View style={styles.badge}>
                <Text style={styles.badgeLabel}>SIZE</Text>
                <Text style={styles.badgeValue}>{formatBytes(totalSize)}</Text>
              </View>
              <View style={styles.badge}>
                <Text style={styles.badgeLabel}>VERSION</Text>
                <Text style={styles.badgeValue}>{version}</Text>
              </View>
            </View>

            <TouchableOpacity style={styles.primaryBtn} onPress={startUpdate} activeOpacity={0.8}>
              <Text style={styles.primaryBtnText}>Install Update</Text>
            </TouchableOpacity>

            <Text style={styles.hint}>Keeps your app current · Takes ~10 seconds</Text>
          </View>
        )}

        {/* ── DOWNLOADING ───────────────────────────────────────────────── */}
        {screenState === 'downloading' && (
          <View style={styles.section}>
            <Text style={styles.title}>Downloading…</Text>

            {/* Bytes display */}
            <View style={styles.sizeRow}>
              <Text style={styles.sizeText}>{formatBytes(downloaded)}</Text>
              <Text style={styles.sizeSep}> / </Text>
              <Text style={styles.sizeTotalText}>{formatBytes(totalSize)}</Text>
              <Text style={styles.sizePercent}>  {progress}%</Text>
            </View>

            {/* Progress track */}
            <View style={styles.trackOuter}>
              <Animated.View style={[styles.trackFill, { width: barWidth }]}>
                {/* Moving shimmer on the fill */}
                <View style={styles.trackShimmer} />
              </Animated.View>
              {/* Glowing tip dot */}
              <Animated.View style={[styles.trackTip, { left: tipLeft }]} />
            </View>

            <Text style={styles.hint}>Please keep the app open</Text>
          </View>
        )}

        {/* ── DONE ──────────────────────────────────────────────────────── */}
        {screenState === 'done' && (
          <View style={styles.section}>
            <Text style={styles.title}>Update Applied!</Text>
            <Text style={styles.subtitle}>Restarting to the new version…</Text>
            {/* Thin spinner line */}
            <View style={styles.restartingRow}>
              <View style={styles.dotActive} />
              <View style={styles.dotMid} />
              <View style={styles.dotDim} />
            </View>
          </View>
        )}

        {/* ── ERROR ─────────────────────────────────────────────────────── */}
        {screenState === 'error' && (
          <View style={styles.section}>
            <Text style={styles.title}>Update Failed</Text>
            <Text style={styles.errorText}>{errorMsg}</Text>

            <TouchableOpacity style={styles.primaryBtn} onPress={startUpdate} activeOpacity={0.8}>
              <Text style={styles.primaryBtnText}>Retry</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.skipBtn}
              onPress={() => navigation.reset({ index: 0, routes: [{ name: 'Selection' }] })}
              activeOpacity={0.7}
            >
              <Text style={styles.skipText}>Skip for now</Text>
            </TouchableOpacity>
          </View>
        )}

      </Animated.View>
    </View>
  );
};

// ─── Styles — dark space theme ────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bgBase: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#090914',
  },
  bgGrad1: {
    ...StyleSheet.absoluteFillObject,
    // Simulated radial glow — top-center cyan
    borderRadius: 9999,
    width: SW * 1.6,
    height: SW * 1.6,
    top: -SW * 0.6,
    left: -SW * 0.3,
    opacity: 0.04,
    backgroundColor: '#00D4FF',
  },
  bgGrad2: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 9999,
    width: SW * 1.4,
    height: SW * 1.4,
    top: SW * 0.3,
    left: SW * 0.1,
    opacity: 0.03,
    backgroundColor: '#A78BFA',
  },
  content: {
    alignItems: 'center',
    paddingHorizontal: 32,
    width: '100%',
  },

  // ── Icon area
  iconArea: {
    width: 160,
    height: 160,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 36,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(0,212,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(0,212,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontSize: 28,
    color: '#00D4FF',
    fontFamily: FF.bold,
  },

  // ── Section
  section: {
    alignItems: 'center',
    width: '100%',
  },
  title: {
    fontSize: 26,
    fontFamily: FF.bold,
    color: '#FFFFFF',
    marginBottom: 8,
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  subtitle: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.55)',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
    fontFamily: FF.regular,
  },

  // ── Meta badges
  metaRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 32,
  },
  badge: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 10,
    minWidth: 100,
  },
  badgeLabel: {
    fontSize: 10,
    letterSpacing: 1.5,
    color: 'rgba(255,255,255,0.35)',
    fontFamily: FF.bold,
    marginBottom: 4,
  },
  badgeValue: {
    fontSize: 16,
    fontFamily: FF.bold,
    color: '#00D4FF',
  },

  // ── Buttons
  primaryBtn: {
    backgroundColor: '#00D4FF',
    paddingVertical: 14,
    paddingHorizontal: 52,
    borderRadius: 12,
    marginBottom: 16,
    shadowColor: '#00D4FF',
    shadowRadius: 14,
    shadowOpacity: 0.35,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  primaryBtnText: {
    color: '#090914',
    fontSize: 16,
    fontFamily: FF.bold,
    letterSpacing: 0.4,
  },
  skipBtn: {
    padding: 10,
    marginTop: 4,
  },
  skipText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.3)',
    fontFamily: FF.regular,
    textDecorationLine: 'underline',
  },
  hint: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.3)',
    fontFamily: FF.regular,
    marginTop: 4,
    letterSpacing: 0.2,
  },

  // ── Progress area
  sizeRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 18,
  },
  sizeText: {
    fontSize: 22,
    fontFamily: FF.bold,
    color: '#00D4FF',
  },
  sizeSep: {
    fontSize: 18,
    color: 'rgba(255,255,255,0.25)',
    fontFamily: FF.regular,
  },
  sizeTotalText: {
    fontSize: 18,
    fontFamily: FF.regular,
    color: 'rgba(255,255,255,0.45)',
  },
  sizePercent: {
    fontSize: 14,
    fontFamily: FF.mono,
    color: 'rgba(255,255,255,0.35)',
  },
  trackOuter: {
    width: SW - 72,
    height: 5,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 3,
    overflow: 'visible',
    marginBottom: 20,
  },
  trackFill: {
    height: 5,
    backgroundColor: '#00D4FF',
    borderRadius: 3,
    overflow: 'hidden',
  },
  trackShimmer: {
    position: 'absolute',
    top: 0, bottom: 0,
    width: 40,
    backgroundColor: 'rgba(255,255,255,0.3)',
    right: 0,
    borderRadius: 3,
  },
  trackTip: {
    position: 'absolute',
    top: -4,
    width: 13, height: 13,
    borderRadius: 7,
    backgroundColor: '#00D4FF',
    shadowColor: '#00D4FF',
    shadowRadius: 8,
    shadowOpacity: 0.9,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },

  // ── Done / Restarting
  restartingRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 24,
  },
  dotActive: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: '#00D4FF',
  },
  dotMid: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: 'rgba(0,212,255,0.45)',
  },
  dotDim: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: 'rgba(0,212,255,0.15)',
  },

  // ── Error
  errorText: {
    fontSize: 14,
    color: '#FF6B6B',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 28,
    fontFamily: FF.regular,
  },
});

export default OTAUpdateScreen;