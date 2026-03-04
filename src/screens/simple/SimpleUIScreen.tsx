// src/screens/simple/SimpleUIScreen.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Platform,
} from 'react-native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../../types/navigation';
import { useChannelContext } from '../../context/ChannelContext';
import { APP_CONFIG } from '../../constants/config';
import VideoPlayer from '../../components/player/VideoPlayer';
import Keypad from '../../components/channel/Keypad';
import ChannelList from '../../components/channel/ChannelList';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useOrientation } from '../../hooks/useOrientation';

// ─── Safe TV event hook ───────────────────────────────────────────────────────
// `TVEventHandler` (class) was removed in newer RN versions.
// `useTVEventHandler` (hook) is its replacement — only exists in react-native-tvos
// builds, so we import it dynamically so the app doesn't crash on regular Android.
type TVEventHandlerHook = (cb: (evt: { eventType: string }) => void) => void;

const _useTVEventHandler: TVEventHandlerHook | null = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('react-native').useTVEventHandler ?? null;
  } catch {
    return null;
  }
})();

// Stable no-op so hooks count never changes between renders
const _noopHook: TVEventHandlerHook = (_cb) => {
  useEffect(() => {}, []); // same hook count as the real one
};

// Always call the same hook — swap implementation, not call count
const useSafeTVEvents = _useTVEventHandler ?? _noopHook;

// ─────────────────────────────────────────────────────────────────────────────

type SimpleUIScreenNavigationProp = StackNavigationProp<RootStackParamList, 'SimpleUI'>;

interface Props {
  navigation: SimpleUIScreenNavigationProp;
}

const SimpleUIScreen: React.FC<Props> = ({ navigation }) => {
  const { currentChannel, setCurrentChannel, filteredChannels, channels } =
    useChannelContext();
  const [showControls, setShowControls] = useState(true);
  const [channelPage, setChannelPage] = useState(0);
  const { isLandscape, isTV, width } = useOrientation();
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── resetTimer ─────────────────────────────────────────────────────────
  // Call on every user interaction to restart the menu hide countdown.
  //
  // active=false (default) → short delay (APP_CONFIG.CONTROLS_HIDE_DELAY)
  //   Used for: screen tap, remote key, channel selection
  //
  // active=true → long delay (ACTIVE_MENU_DELAY = 12 s)
  //   Used for: any interaction INSIDE the channel list or keypad, so the
  //   user has plenty of time to browse without the menu disappearing.
  const ACTIVE_MENU_DELAY = 12000; // ms — menu stays while user explores
  const resetTimer = useCallback((active = false) => {
    setShowControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(
      () => setShowControls(false),
      active ? ACTIVE_MENU_DELAY : APP_CONFIG.CONTROLS_HIDE_DELAY,
    );
  }, []);

  // Start timer on mount, clean up on unmount
  useEffect(() => {
    resetTimer();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset timer on any TV remote key press
  useSafeTVEvents((_evt) => {
    resetTimer();
  });

  const handleChannelChange = (channelNumber: number) => {
    const channel = channels.find(ch => ch.number === channelNumber);
    if (channel) {
      setCurrentChannel(channel);
      resetTimer(); // user picked a channel → restart countdown
    }
  };

  // ─── Responsive sizing ──────────────────────────────────────────────────
  const channelListWidth = isLandscape
    ? Math.min(Math.floor(width * 0.38), 340)
    : width - 32;

  const keypadWidth = isLandscape
    ? Math.min(Math.floor(width * 0.26), 240)
    : width - 32;

  const topBarHeight = isTV ? 64 : isLandscape ? 48 : 60;

  return (
    <Pressable style={styles.container} onPress={() => resetTimer()}>
      {/* ── Full-screen video background ── */}
      <View style={styles.playerContainer}>
        {currentChannel ? (
          <VideoPlayer channel={currentChannel} />
        ) : (
          <View style={styles.placeholderContainer}>
            <Icon name="television" size={isTV ? 160 : 80} color="#374151" />
            <Text style={[styles.placeholderText, isTV && styles.tvText]}>
              No Channel Selected
            </Text>
          </View>
        )}
      </View>

      {/* ── Transparent tap-catcher on top of the video ──────────────────────
           react-native-video swallows ALL touch events so the outer Pressable
           never fires while a video is playing. This invisible overlay sits
           between the video and the controls overlay and forwards every tap /
           TV-select to resetTimer so the menu always comes back.
           pointerEvents="box-only" means it catches taps on itself but lets
           touches pass through to child views (none here, so effectively a
           full-screen tap target). When controls are already visible the
           overlay is still present but resetTimer() is idempotent — it just
           restarts the countdown.
      ── */}
      <Pressable
        style={styles.tapCatcher}
        onPress={() => resetTimer()}
      />

      {/* ── Transparent tap/click catcher over the video ─────────────────────
           The <Video> component absorbs all touch events and TV remote focus
           when playing, so taps never reach the outer <Pressable>. This
           invisible overlay sits on top of the video (but below the controls)
           and forwards every interaction to resetTimer.
           pointerEvents="box-only" means it catches taps itself but lets
           child views (the controls overlay) handle their own touches normally.
      ── */}
      {!showControls && (
        <Pressable
          style={styles.videoTapCatcher}
          onPress={() => resetTimer()}
        />
      )}

      {/* ── Controls overlay ── */}
      {showControls && (
        <View style={styles.controlsOverlay}>
          {/* Top bar */}
          <View style={[styles.topBar, { height: topBarHeight }]}>
            <View style={styles.topBarLeft}>
              <View style={styles.logoContainer}>
                <Icon name="home" size={isTV ? 28 : 20} color="#fff" />
              </View>
              <View>
                <Text style={[styles.appName, isTV && styles.tvAppName]}>
                  {APP_CONFIG.APP_NAME}
                </Text>
                <Text style={styles.modeName}>Simple-Mode</Text>
              </View>
            </View>

            <View style={styles.topBarRight}>
              {currentChannel && (
                <View style={styles.channelInfo}>
                  <Text style={[styles.channelNumber, isTV && styles.tvChannelNumber]}>
                    CH {currentChannel.number}
                  </Text>
                  <Text style={styles.channelName} numberOfLines={1}>
                    {currentChannel.name}
                  </Text>
                </View>
              )}
              <TouchableOpacity
                style={[styles.settingsButton, isTV && styles.tvButton]}
                onPress={() => { resetTimer(); navigation.navigate('Selection'); }}
                hasTVPreferredFocus={false}
              >
                <Icon name="cog" size={isTV ? 28 : 20} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>

          {/* ── Body panels ── */}
          {isLandscape ? (
            // LANDSCAPE: channel list left, keypad right, never overlapping
            <View style={[styles.bodyLandscape, { top: topBarHeight }]}>
              <View style={[styles.channelListWrapper, { width: channelListWidth }]}>
                <ChannelList
                  channels={filteredChannels}
                  currentChannel={currentChannel}
                  onChannelSelect={handleChannelChange}
                  channelPage={channelPage}
                  setChannelPage={setChannelPage}
                  onActivity={() => resetTimer(true)}
                />
              </View>
              <View style={styles.bodySpacer} />
              <View style={[styles.keypadWrapper, { width: keypadWidth }]}>
                <Keypad onChannelSelect={handleChannelChange} onActivity={() => resetTimer(true)} />
              </View>
            </View>
          ) : (
            // PORTRAIT: channel list only, full-width (no overlap ever)
            <View style={[styles.bodyPortrait, { top: topBarHeight }]}>
              <View style={[styles.channelListWrapper, { width: channelListWidth }]}>
                <ChannelList
                  channels={filteredChannels}
                  currentChannel={currentChannel}
                  onChannelSelect={handleChannelChange}
                  channelPage={channelPage}
                  setChannelPage={setChannelPage}
                  onActivity={() => resetTimer(true)}
                />
              </View>
            </View>
          )}
        </View>
      )}
    </Pressable>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  playerContainer: {
    ...StyleSheet.absoluteFillObject,
  },
  placeholderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0f0f0f',
  },
  placeholderText: {
    fontSize: 18,
    color: '#6b7280',
    marginTop: 12,
  },
  tvText: {
    fontSize: 28,
  },
  // controlsOverlay moved below tapCatcher with zIndex: 2
  // Transparent overlay that sits above the video but below the controls.
  // Only rendered when controls are hidden so it doesn't block menu touches.
  videoTapCatcher: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
    backgroundColor: 'transparent',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    backgroundColor: 'rgba(0,0,0,0.85)',
  },
  topBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  logoContainer: {
    backgroundColor: '#3b82f6',
    padding: 6,
    borderRadius: 8,
    marginRight: 12,
  },
  appName: {
    fontSize: 16,
    fontWeight: '900',
    color: '#fff',
  },
  tvAppName: {
    fontSize: 22,
  },
  modeName: {
    fontSize: 11,
    color: '#9ca3af',
  },
  topBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  channelInfo: {
    alignItems: 'flex-end',
  },
  channelNumber: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#fff',
  },
  tvChannelNumber: {
    fontSize: 20,
  },
  channelName: {
    fontSize: 11,
    color: '#9ca3af',
    maxWidth: 140,
  },
  settingsButton: {
    backgroundColor: 'rgba(55,65,81,0.8)',
    padding: 8,
    borderRadius: 8,
  },
  tvButton: {
    padding: 12,
    borderRadius: 10,
  },
  bodyLandscape: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  bodySpacer: {
    flex: 1,
  },
  bodyPortrait: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    alignItems: 'flex-start',
  },
  // Transparent full-screen overlay that sits on top of the video so taps
  // are never swallowed by react-native-video's internal touch handler.
  tapCatcher: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,          // above video, below controls overlay (zIndex 2+)
    backgroundColor: 'transparent',
  },
  controlsOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,          // always on top
  },
  channelListWrapper: {
    maxHeight: '85%',
  },
  keypadWrapper: {},
});

export default SimpleUIScreen;