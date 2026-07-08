// src/screens/simple/SimpleUIScreen.tsx
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Platform,
  StatusBar,
  Modal,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../types/navigation';
import { useChannelContext } from '../../context/ChannelContext';
import { APP_CONFIG } from '../../constants/config';
import VideoPlayer from '../../components/player/VideoPlayer';
import ChannelList from '../../components/channel/ChannelList';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useOrientation } from '../../hooks/useOrientation';
import { Channel } from '../../types/channel';
import { lockToLandscape, lockToPortrait } from '../../utils/OrientationHelper';

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

type SimpleUIScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'SimpleUI'>;

interface Props {
  navigation: SimpleUIScreenNavigationProp;
}

// ─── Layout constants ─────────────────────────────────────────────────────────
const isTV = Platform.isTV;
const VIDEO_PORTRAIT_HEIGHT_RATIO = 0.30;
const ACTIVE_MENU_DELAY = 12_000;
const PASSIVE_MENU_DELAY = APP_CONFIG.CONTROLS_HIDE_DELAY;
// ─────────────────────────────────────────────────────────────────────────────

const SimpleUIScreen: React.FC<Props> = ({ navigation }) => {
  const { currentChannel, setCurrentChannel, filteredChannels, channels } =
    useChannelContext();
  const [showControls, setShowControls] = useState(true);
  const [channelPage, setChannelPage] = useState(0);

  const { isLandscape, width, height } = useOrientation();
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const STATUS_BAR_HEIGHT = Platform.select({
    android: StatusBar.currentHeight ?? 0,
    ios: 20,
    default: 0,
  }) || 0;

  // ─── Fullscreen state (uses same VideoPlayer instance, no modal) ─────────
  const [isFullscreen, setIsFullscreen] = useState(false);

  const handleEnterFullscreen = useCallback(() => {
    lockToLandscape();
    setIsFullscreen(true);
  }, []);

  const handleExitFullscreenStable = useCallback(() => {
    setIsFullscreen(false);
    lockToPortrait();
    resetPortraitControlsRef.current();
  }, []);

  // ─── Stream source modal ──────────────────────────────────────────────────
  const [streamModalVisible, setStreamModalVisible] = useState(false);

  // ─── Portrait controls auto‑hide ─────────────────────────────────────────
  const [showPortraitControls, setShowPortraitControls] = useState(true);
  const portraitHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetPortraitControls = useCallback(() => {
    setShowPortraitControls(true);
    if (portraitHideTimer.current) clearTimeout(portraitHideTimer.current);
    portraitHideTimer.current = setTimeout(() => {
      setShowPortraitControls(false);
    }, 3000);
  }, []);

  // Wire resetPortraitControls into handleExitFullscreenStable via a ref so it is
  // always fresh without causing circular deps in useCallback.
  const resetPortraitControlsRef = useRef(resetPortraitControls);
  useEffect(() => { resetPortraitControlsRef.current = resetPortraitControls; }, [resetPortraitControls]);

  useEffect(() => {
    resetPortraitControls();
    return () => {
      if (portraitHideTimer.current) clearTimeout(portraitHideTimer.current);
    };
  }, [resetPortraitControls]);

  // ─── Video keys ───────────────────────────────────────────────────────────
  // Only one key needed now – the inline player expands to fullscreen.
  const baseVideoKey = useMemo(() => {
    if (!currentChannel) return 'no-channel';
    return `${currentChannel.id}-${currentChannel.streamUrl}`;
  }, [currentChannel?.id, currentChannel?.streamUrl]);

  const portraitVideoKey = `portrait-${baseVideoKey}`;

  // ─── Landscape / TV timer ─────────────────────────────────────────────────
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
  }, [resetTimer]);

  const handleTVEvent = useCallback(() => resetTimer(), [resetTimer]);
  useSafeTVEvents(handleTVEvent);

  const handleChannelChange = useCallback((channelNumber: number) => {
    const channel = channels.find(ch => ch.number === channelNumber);
    if (channel) {
      setCurrentChannel(channel);
      resetTimer();
    }
  }, [channels, setCurrentChannel, resetTimer]);

  // ─── Stream source switching ──────────────────────────────────────────────
  const handleStreamSelect = useCallback((index: number) => {
    if (!currentChannel) return;
    const urls = [...currentChannel.streamUrls];
    if (index >= urls.length) return;
    const [selectedEntry] = urls.splice(index, 1);
    urls.unshift(selectedEntry);

    const updatedChannel: Channel = {
      ...currentChannel,
      streamUrl: selectedEntry.url,
      streamUrls: urls,
      licenseType: selectedEntry.licenseType || null,
      licenseKey: selectedEntry.licenseKey || null,
      userAgent: selectedEntry.userAgent || null,
      httpHeaders: selectedEntry.httpHeaders || null,
    };
    setCurrentChannel(updatedChannel);
    setStreamModalVisible(false);
    resetPortraitControls();
  }, [currentChannel, setCurrentChannel, resetPortraitControls]);

  // ─── Dimensions ───────────────────────────────────────────────────────────
  const screenHeight = height;
  const videoPortraitH = Math.round(screenHeight * VIDEO_PORTRAIT_HEIGHT_RATIO);
  const topBarHeight = isTV ? 68 : 56;

  const isPortraitPhone = !isTV && !isLandscape;

  return (
    <View style={styles.root}>
      <StatusBar
        barStyle="light-content"
        backgroundColor="transparent"
        translucent
      />

      {/* ═══════════════════════════════════════════════════════════════════
          PORTRAIT PHONE
      ═══════════════════════════════════════════════════════════════════ */}
      {isPortraitPhone ? (
        <View style={styles.root}>
          {/* Video strip */}
          <Pressable
            style={[styles.videoStrip, { height: videoPortraitH }]}
            onPress={resetPortraitControls}
          >
            {currentChannel ? (
              <View style={{ marginTop: STATUS_BAR_HEIGHT, flex: 1 }}>
                <VideoPlayer
                  key={portraitVideoKey}
                  channel={currentChannel}
                  fullscreen={isFullscreen}              // same player, expand
                  onFullscreenDismiss={handleExitFullscreenStable}
                />
                {/* Exit-fullscreen button – only visible in fullscreen */}
                {isFullscreen && (
                  <TouchableOpacity
                    style={fullscreenStyles.exitBtn}
                    onPress={handleExitFullscreenStable}
                    accessibilityLabel="Exit full screen"
                  >
                    <Icon name="fullscreen-exit" size={24} color="#fff" />
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              <View style={{ marginTop: STATUS_BAR_HEIGHT, flex: 1 }}>
                <NoChannelPlaceholder isTV={false} />
              </View>
            )}

            {/* Top bar — auto‑hides after 3 s */}
            {showPortraitControls && !isFullscreen && (
              <View style={[styles.portraitTopBar, { height: topBarHeight, top: STATUS_BAR_HEIGHT }]}>
                <AppLogo />
                {currentChannel && (
                  <View style={styles.portraitChannelBadge}>
                    <Text style={styles.portraitChName} numberOfLines={1}>
                      {currentChannel.name}
                    </Text>
                  </View>
                )}
                <View style={styles.topBarRightIcons}>
                  {/* Fullscreen button */}
                  <TouchableOpacity
                    onPress={handleEnterFullscreen}
                    style={styles.iconButton}
                    accessibilityLabel="Enter full screen"
                  >
                    <Icon name="fullscreen" size={20} color="#94a3b8" />
                  </TouchableOpacity>
                  <SettingsButton
                    onPress={() => { resetPortraitControls(); setStreamModalVisible(true); }}
                  />
                </View>
              </View>
            )}
          </Pressable>

          {/* Channel list */}
          <View style={styles.portraitListContainer}>
            <ChannelList
              channels={filteredChannels}
              currentChannel={currentChannel}
              onChannelSelect={handleChannelChange}
              channelPage={channelPage}
              setChannelPage={setChannelPage}
              onActivity={() => resetTimer(true)}
              showEPG={false}
              isLandscape={false}
            />
          </View>
        </View>
      ) : (
        /* ═══════════════════════════════════════════════════════════════════
            LANDSCAPE / TABLET / TV — completely unchanged
        ═══════════════════════════════════════════════════════════════════ */
        <Pressable style={styles.root} onPress={() => resetTimer()}>
          <View style={StyleSheet.absoluteFill}>
            {currentChannel ? (
              <VideoPlayer
                key={baseVideoKey}
                channel={currentChannel}
                fullscreen={false}
                onFullscreenDismiss={() => {}}
              />
            ) : (
              <NoChannelPlaceholder isTV={isTV} />
            )}
          </View>

          <Pressable
            style={[StyleSheet.absoluteFill, styles.tapCatcher, { zIndex: showControls ? 1 : 10 }]}
            onPress={() => resetTimer()}
          />

          {showControls && (
            <View style={styles.controlsOverlay}>
              <View style={[styles.scrim, { pointerEvents: 'none' }]} />
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
                  <SettingsButton
                    onPress={() => { resetTimer(); navigation.navigate('Selection'); }}
                  />
                </View>
              </View>

              <View style={[styles.panel, { top: topBarHeight }]}>
                <ChannelList
                  channels={filteredChannels}
                  currentChannel={currentChannel}
                  onChannelSelect={handleChannelChange}
                  channelPage={channelPage}
                  setChannelPage={setChannelPage}
                  onActivity={() => resetTimer(true)}
                  showEPG
                  isLandscape={isLandscape}
                />
              </View>
            </View>
          )}
        </Pressable>
      )}

      {/* ── Stream source modal ─────────────────────────────────────────────── */}
      <Modal
        visible={streamModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setStreamModalVisible(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setStreamModalVisible(false)}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Available Streams</Text>
            {currentChannel?.streamUrls.length ? (
              currentChannel.streamUrls.map((_entry, index) => (
                <TouchableOpacity
                  key={index}
                  style={[
                    styles.streamItem,
                    currentChannel.streamUrl === currentChannel.streamUrls[index]?.url &&
                      styles.streamItemActive,
                  ]}
                  onPress={() => handleStreamSelect(index)}
                >
                  <Text style={styles.streamItemText}>Stream {index + 1}</Text>
                </TouchableOpacity>
              ))
            ) : (
              <Text style={styles.noStreamsText}>No alternate sources available</Text>
            )}
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setStreamModalVisible(false)}
            >
              <Text style={styles.closeButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
};

// ─── Sub‑components ───────────────────────────────────────────────────────────

const AppLogo: React.FC = () => (
  <View style={logoStyles.container}>
    <Icon name="television-play" size={isTV ? 26 : 18} color="#fff" />
  </View>
);

const SettingsButton: React.FC<{ onPress: () => void }> = ({ onPress }) => (
  <Pressable
    style={settingsStyles.btn}
    onPress={onPress}
    hasTVPreferredFocus={false}
    accessibilityLabel="Settings"
    accessible={true}
  >
    <Icon name="cog-outline" size={isTV ? 26 : 20} color="#94a3b8" />
  </Pressable>
);

const NoChannelPlaceholder: React.FC<{ isTV: boolean }> = ({ isTV: tv }) => (
  <View style={placeholderStyles.container}>
    <Icon name="television-off" size={tv ? 120 : 60} color="#1e293b" />
    <Text style={[placeholderStyles.text, tv && placeholderStyles.tvText]}>
      No Channel Selected
    </Text>
    <Text style={placeholderStyles.sub}>Select a channel from the list</Text>
  </View>
);

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#030712',
  },
  videoStrip: {
    width: '100%',
    backgroundColor: '#030712',
    overflow: 'hidden',
  },
  portraitTopBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    backgroundColor: 'rgba(3,7,18,0.85)',
    gap: 8,
    zIndex: 20,
  },
  portraitChannelBadge: {
    flex: 1,
    alignItems: 'center',
  },
  portraitChName: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '600',
    maxWidth: 200,
  },
  portraitListContainer: {
    flex: 1,
    backgroundColor: '#030712',
  },
  topBarRightIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconButton: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(30,41,59,0.6)',
    borderWidth: 1,
    borderColor: '#334155',
  },

  // Landscape / TV
  tapCatcher: {
    zIndex: 1,
    backgroundColor: 'transparent',
  },
  controlsOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 5,
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(3,7,18,0.55)',
  },
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
  appName: { fontSize: 15, fontWeight: '900', color: '#f1f5f9', letterSpacing: 0.3 },
  tvAppName: { fontSize: 20 },
  modeName: { fontSize: 10, color: '#334155', fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.8 },
  topBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  channelInfoBadge: { alignItems: 'flex-end', marginRight: 4 },
  chNumBig: { fontSize: 13, fontWeight: '800', color: '#60a5fa', letterSpacing: 1 },
  tvChNumBig: { fontSize: 18 },
  chNameSmall: { fontSize: 11, color: '#475569', maxWidth: 160, flexShrink: 1 },
  panel: {
    position: 'absolute',
    left: isTV ? 14 : 8,
    right: isTV ? 14 : 8,
    bottom: isTV ? 14 : 8,
  },

  // Stream modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#0f172a',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '70%',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f1f5f9',
    marginBottom: 16,
    textAlign: 'center',
  },
  streamItem: {
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
    borderRadius: 8,
    marginBottom: 4,
  },
  streamItemActive: {
    backgroundColor: 'rgba(59,130,246,0.15)',
    borderLeftWidth: 3,
    borderLeftColor: '#3b82f6',
  },
  streamItemText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#e2e8f0',
  },
  noStreamsText: {
    color: '#64748b',
    textAlign: 'center',
    marginVertical: 20,
  },
  closeButton: {
    marginTop: 16,
    alignSelf: 'center',
    paddingVertical: 10,
    paddingHorizontal: 24,
    backgroundColor: '#1e293b',
    borderRadius: 10,
  },
  closeButtonText: {
    color: '#94a3b8',
    fontWeight: '600',
  },
});

const fullscreenStyles = StyleSheet.create({
  exitBtn: {
    position: 'absolute',
    top: 16,
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: 8,
    borderRadius: 8,
    zIndex: 10,
  },
});

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

const settingsStyles = StyleSheet.create({
  btn: {
    backgroundColor: 'rgba(30,41,59,0.8)',
    padding: isTV ? 12 : 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
});

const placeholderStyles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#030712',
    gap: 10,
  },
  text: { fontSize: 18, color: '#1f2937', fontWeight: '700' },
  tvText: { fontSize: 28 },
  sub: { fontSize: 13, color: '#111827' },
});

export default SimpleUIScreen;