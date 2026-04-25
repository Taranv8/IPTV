// src/screens/simple/SimpleUIScreen.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Platform,
  Dimensions,
  StatusBar,
} from 'react-native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../../types/navigation';
import { useChannelContext } from '../../context/ChannelContext';
import { APP_CONFIG } from '../../constants/config';
import VideoPlayer from '../../components/player/VideoPlayer';
import ChannelList from '../../components/channel/ChannelList';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useOrientation } from '../../hooks/useOrientation';

// ─── Safe TV event hook ───────────────────────────────────────────────────────
type TVEventHandlerHook = (cb: (evt: { eventType: string }) => void) => void;

const _useTVEventHandler: TVEventHandlerHook | null = (() => {
  try {
    return require('react-native').useTVEventHandler ?? null;
  } catch {
    return null;
  }
})();

const _noopHook: TVEventHandlerHook = (_cb) => {
  useEffect(() => {}, []);
};

const useSafeTVEvents = _useTVEventHandler ?? _noopHook;

// ─────────────────────────────────────────────────────────────────────────────

type SimpleUIScreenNavigationProp = StackNavigationProp<RootStackParamList, 'SimpleUI'>;

interface Props {
  navigation: SimpleUIScreenNavigationProp;
}

// ─── Layout constants ─────────────────────────────────────────────────────────
const isTV = Platform.isTV;

// Portrait phone: video takes top 32%, channel list takes rest
// Landscape / TV: video is full-screen background, overlay panel on top
const VIDEO_PORTRAIT_HEIGHT_RATIO = 0.32;

// ─────────────────────────────────────────────────────────────────────────────

const SimpleUIScreen: React.FC<Props> = ({ navigation }) => {
  const { currentChannel, setCurrentChannel, filteredChannels, channels } =
    useChannelContext();
  const [showControls, setShowControls] = useState(true);
  const [channelPage, setChannelPage] = useState(0);
  const { isLandscape, width, height } = useOrientation();
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Portrait phone: EPG is hidden to save space
  const showEPG = isTV || isLandscape;

  // ─── Timer ────────────────────────────────────────────────────────────────
  const ACTIVE_MENU_DELAY  = 12_000;
  const PASSIVE_MENU_DELAY = APP_CONFIG.CONTROLS_HIDE_DELAY;

  const resetTimer = useCallback((active = false) => {
    setShowControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(
      () => setShowControls(false),
      active ? ACTIVE_MENU_DELAY : PASSIVE_MENU_DELAY,
    );
  }, []);

  useEffect(() => {
    resetTimer();
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useSafeTVEvents((_evt) => resetTimer());

  const handleChannelChange = (channelNumber: number) => {
    const channel = channels.find(ch => ch.number === channelNumber);
    if (channel) {
      setCurrentChannel(channel);
      resetTimer();
    }
  };

  // ─── Dimensions ───────────────────────────────────────────────────────────
  const screenWidth  = width;
  const screenHeight = height;

  // Portrait phone: video height
  const videoPortraitH = Math.round(screenHeight * VIDEO_PORTRAIT_HEIGHT_RATIO);

  // TV top bar height
  const topBarHeight = isTV ? 68 : 56;

  // ─────────────────────────────────────────────────────────────────────────
  // PORTRAIT PHONE layout:
  //   ┌──────────────────────┐
  //   │  Video (32% height)  │
  //   ├──────────────────────┤  ← topBar floats above the divider
  //   │  Channel List (flex) │
  //   └──────────────────────┘
  //
  // LANDSCAPE / TV layout:
  //   Full-screen video + semi-transparent overlay panel
  // ─────────────────────────────────────────────────────────────────────────

  const isPortraitPhone = !isTV && !isLandscape;

  return (
    <View style={styles.root}>
      <StatusBar
        barStyle="light-content"
        backgroundColor="transparent"
        translucent
      />

      {/* ═══════════════════════════════════════════════════════════════════
          PORTRAIT PHONE — stacked layout
      ═══════════════════════════════════════════════════════════════════ */}
      {isPortraitPhone ? (
        <Pressable style={styles.root} onPress={() => resetTimer()}>
          {/* Video strip */}
          <View style={[styles.videoStrip, { height: videoPortraitH }]}>
            {currentChannel ? (
              <VideoPlayer channel={currentChannel} />
            ) : (
              <NoChannelPlaceholder isTV={false} />
            )}

            {/* Top bar floats over the video */}
            <View style={[styles.portraitTopBar, { height: topBarHeight }]}>
              <AppLogo />
              {currentChannel && (
                <View style={styles.portraitChannelBadge}>
                  <Text style={styles.portraitChNum}>CH {currentChannel.number}</Text>
                  <Text style={styles.portraitChName} numberOfLines={1}>
                    {currentChannel.name}
                  </Text>
                </View>
              )}
              <SettingsButton onPress={() => { resetTimer(); navigation.navigate('Selection'); }} />
            </View>
          </View>

          {/* Channel list — full remaining height */}
          <View style={styles.portraitListContainer}>
            <ChannelList
              channels={filteredChannels}
              currentChannel={currentChannel}
              onChannelSelect={handleChannelChange}
              channelPage={channelPage}
              setChannelPage={setChannelPage}
              onActivity={() => resetTimer(true)}
              showEPG={false}
            />
          </View>
        </Pressable>
      ) : (
        /* ═══════════════════════════════════════════════════════════════════
            LANDSCAPE PHONE / TABLET / TV — full-screen video + overlay
        ═══════════════════════════════════════════════════════════════════ */
        <Pressable style={styles.root} onPress={() => resetTimer()}>
          {/* Full-screen video background */}
          <View style={StyleSheet.absoluteFill}>
            {currentChannel ? (
              <VideoPlayer channel={currentChannel} />
            ) : (
              <NoChannelPlaceholder isTV={isTV} />
            )}
          </View>

          {/* Tap catcher (video swallows touches) */}
          <Pressable style={[StyleSheet.absoluteFill, styles.tapCatcher]} onPress={() => resetTimer()} />

          {/* Invisible tap catcher when controls are hidden */}
          {!showControls && (
            <Pressable
              style={[StyleSheet.absoluteFill, styles.tapCatcher, { zIndex: 10 }]}
              onPress={() => resetTimer()}
            />
          )}

          {/* Controls overlay */}
          {showControls && (
            <View style={styles.controlsOverlay}>
              {/* Gradient scrim — darkens bottom half for readability */}
              <View style={styles.scrim} pointerEvents="none" />

              {/* Top bar */}
              <View style={[styles.topBar, { height: topBarHeight }]}>
                <View style={styles.topBarLeft}>
                  <AppLogo />
                  <View>
                    <Text style={[styles.appName, isTV && styles.tvAppName]}>
                      {APP_CONFIG.APP_NAME}
                    </Text>
                    <Text style={styles.modeName}>Simple Mode</Text>
                  </View>
                </View>
                <View style={styles.topBarRight}>
                  {currentChannel && (
                    <View style={styles.channelInfoBadge}>
                      <Text style={[styles.chNumBig, isTV && styles.tvChNumBig]}>
                        CH {currentChannel.number}
                      </Text>
                      <Text style={styles.chNameSmall} numberOfLines={1}>
                        {currentChannel.name}
                      </Text>
                    </View>
                  )}
                  <SettingsButton onPress={() => { resetTimer(); navigation.navigate('Selection'); }} />
                </View>
              </View>

              {/* Channel list panel — full width, fills remaining space */}
              <View style={[styles.panel, { top: topBarHeight }]}>
                <ChannelList
                  channels={filteredChannels}
                  currentChannel={currentChannel}
                  onChannelSelect={handleChannelChange}
                  channelPage={channelPage}
                  setChannelPage={setChannelPage}
                  onActivity={() => resetTimer(true)}
                  showEPG={showEPG}
                />
              </View>
            </View>
          )}
        </Pressable>
      )}
    </View>
  );
};

// ─── Sub-components ───────────────────────────────────────────────────────────

const AppLogo: React.FC = () => (
  <View style={logoStyles.container}>
    <Icon name="television-play" size={isTV ? 26 : 18} color="#fff" />
  </View>
);

const logoStyles = StyleSheet.create({
  container: {
    backgroundColor: '#1d4ed8',
    padding: isTV ? 10 : 7,
    borderRadius: 10,
    marginRight: 10,
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 8,
    elevation: 6,
  },
});

const SettingsButton: React.FC<{ onPress: () => void }> = ({ onPress }) => (
  <TouchableOpacity
    style={settingsStyles.btn}
    onPress={onPress}
    hasTVPreferredFocus={false}
    accessibilityLabel="Settings"
  >
    <Icon name="cog-outline" size={isTV ? 26 : 20} color="#94a3b8" />
  </TouchableOpacity>
);

const settingsStyles = StyleSheet.create({
  btn: {
    backgroundColor: 'rgba(30,41,59,0.8)',
    padding: isTV ? 12 : 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
});

const NoChannelPlaceholder: React.FC<{ isTV: boolean }> = ({ isTV: tv }) => (
  <View style={placeholderStyles.container}>
    <Icon name="television-off" size={tv ? 120 : 60} color="#1e293b" />
    <Text style={[placeholderStyles.text, tv && placeholderStyles.tvText]}>
      No Channel Selected
    </Text>
    <Text style={placeholderStyles.sub}>Select a channel from the list</Text>
  </View>
);

const placeholderStyles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#030712',
    gap: 10,
  },
  text: {
    fontSize: 18,
    color: '#1f2937',
    fontWeight: '700',
  },
  tvText: { fontSize: 28 },
  sub: {
    fontSize: 13,
    color: '#111827',
  },
});

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#030712',
  },

  // ── Portrait phone ──────────────────────────────────────────────────────────
  videoStrip: {
    width: '100%',
    backgroundColor: '#030712',
    overflow: 'hidden',
  },
  portraitTopBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    backgroundColor: 'rgba(3,7,18,0.75)',
    gap: 8,
  },
  portraitChannelBadge: {
    flex: 1,
    alignItems: 'center',
  },
  portraitChNum: {
    color: '#60a5fa',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },
  portraitChName: {
    color: '#94a3b8',
    fontSize: 11,
    maxWidth: 150,
  },
  portraitListContainer: {
    flex: 1,
    backgroundColor: '#030712',
  },

  // ── Landscape / TV overlay ──────────────────────────────────────────────────
  tapCatcher: {
    zIndex: 1,
    backgroundColor: 'transparent',
  },
  controlsOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 5,
  },

  // Gradient scrim from transparent (top) to deep navy (bottom)
  scrim: {
    ...StyleSheet.absoluteFillObject,
    // React Native doesn't support CSS linear-gradient natively.
    // Use react-native-linear-gradient if available; fallback to semi-solid.
    backgroundColor: 'rgba(3,7,18,0.55)',
  },

  // Top bar
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: isTV ? 20 : 14,
    backgroundColor: 'rgba(3,7,18,0.9)',
    borderBottomWidth: 1,
    borderBottomColor: '#0f172a',
    zIndex: 10,
  },
  topBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  appName: {
    fontSize: 15,
    fontWeight: '900',
    color: '#f1f5f9',
    letterSpacing: 0.3,
  },
  tvAppName: { fontSize: 20 },
  modeName: {
    fontSize: 10,
    color: '#334155',
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  topBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  channelInfoBadge: {
    alignItems: 'flex-end',
    marginRight: 4,
  },
  chNumBig: {
    fontSize: 13,
    fontWeight: '800',
    color: '#60a5fa',
    letterSpacing: 1,
  },
  tvChNumBig: { fontSize: 18 },
  chNameSmall: {
    fontSize: 11,
    color: '#475569',
    maxWidth: 160,
    flexShrink: 1,
  },

  // Full-width channel list panel below the top bar
  panel: {
    position: 'absolute',
    left: isTV ? 14 : 8,
    right: isTV ? 14 : 8,
    bottom: isTV ? 14 : 8,
  },
});

export default SimpleUIScreen;