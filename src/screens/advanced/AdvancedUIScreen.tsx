// src/screens/advanced/AdvancedUIScreen.tsx
//
// Advanced UI — channel grid with:
//   • Portrait  → 2-col grid; selecting a channel opens a YouTube-style
//                 "Now Playing" sub-page (back → returns to grid)
//   • Landscape / fullscreen → one immersive player, no channel recommendations
//   • TV        → full-bleed player with minimal top chrome only
//
// ── FIX: SINGLE PERSISTENT PLAYER ───────────────────────────────────────────
// Previously this screen had 3 separate early-return branches, each mounting
// its own <VideoPlayer>, plus a 4th copy inside a <Modal> for the "fullscreen"
// button. Every transition (NowPlaying → fullscreen, rotate, fullscreen →
// back) unmounted one VideoPlayer and mounted a brand new one, which forced
// VideoPlayer's init effect to re-run StreamResolver.resolve() and rebuild
// the native <Video> node from scratch — throwing away all buffered content
// and opening a fresh connection every time.
//
// Now there is exactly ONE <VideoPlayer key={baseKey} .../> in the whole
// component. It's rendered from a single spot in the tree; only its
// *container's style* (and the chrome layered around it) changes between
// "embedded in Now Playing", "landscape/fullscreen", and "TV overlay". Since
// React reconciles by position + key, not by which conditional branch wrote
// the JSX, the same instance survives all of those transitions.
//
// There's no more RN <Modal> for fullscreen either — Modal renders into a
// separate native window, which would have made "don't remount" impossible
// without much deeper native work. Fullscreen is now just an absolutely
// positioned, full-bleed <View> in the same tree.
//
// ── FIX: EXIT-FULLSCREEN BUTTON ALWAYS AVAILABLE ────────────────────────────
// The exit button previously only rendered while BOTH `chromeSettled` AND
// `showControls` were true, so it disappeared with the rest of the
// auto-hiding chrome and could be effectively impossible to find/tap again
// (especially over a native Android video surface, which can paint above
// sibling RN views regardless of JS z-index). It's now rendered unconditionally
// any time `fullscreenActive` is true — it never auto-hides, and it isn't part
// of the "tap to reveal controls" flow. `elevation` was added so Android keeps
// it visually on top of the native video surface.
//
// ── FIX: STATUS BAR OVERLAP ──────────────────────────────────────────────────
// The embedded "Now Playing" player (portrait, non-fullscreen) is the very
// first thing in the tree and sat flush against y=0. With a translucent
// StatusBar, that meant the top sliver of the video was drawn *underneath*
// the status bar. It now gets `marginTop: STATUS_BAR_HEIGHT` so it starts
// just below it, matching the grid header and the TV top bar (which already
// accounted for this).
//
// ── FIX: NO CHANNEL RECOMMENDATIONS WHILE STREAMING FULLSCREEN ──────────────
// Previously, phone fullscreen showed a "Switch Channel" mini-row and TV
// always showed a full channel grid overlaid on the playing video. Both are
// removed: once a channel is actually streaming fullscreen (phone landscape/
// fullscreen OR TV), the player is the only thing on screen (plus a small,
// auto-hiding name/exit chrome) — no other-channel list, no grid. Channel
// switching still works exactly the way it did before entering that state:
// the "Up Next" recommendations on the (non-fullscreen) Now Playing page on
// phone, and the initial channel grid before a channel is loaded.
//
// ── ADDED: IMMERSIVE NAV BAR + CENTER PLAY/PAUSE + TV D-PAD FOCUS ───────────
// • enterImmersive()/exitImmersive() hide the 3-button Android nav bar while
//   fullscreenActive, restoring it (swipe-to-reveal) the rest of the time.
// • A single `isPaused` boolean, lifted here and passed down as the `paused`
//   prop to <VideoPlayer>, drives one shared center play/pause button that
//   renders in both the embedded "Now Playing" view and fullscreen/TV.
// • On TV, the play/pause button gets initial D-pad focus, and D-pad Up from
//   it jumps straight to the exit-fullscreen button via `nextFocusUp`.
// ─────────────────────────────────────────────────────────────────────────────

import React, {
  useState,
  useRef,
  useCallback,
  useMemo,
  useEffect,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  FlatList,
  Image,
  ScrollView,
  Platform,
  StatusBar,
  Animated,
  BackHandler,
  findNodeHandle,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../types/navigation';
import { useChannelContext } from '../../context/ChannelContext';
import { APP_CONFIG } from '../../constants/config';
import VideoPlayer from '../../components/player/VideoPlayer';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useOrientation } from '../../hooks/useOrientation';
import { Channel } from '../../types/channel';
import { lockToLandscape, lockToPortrait } from '../../utils/OrientationHelper';
import { enterImmersive, exitImmersive } from '../../utils/ImmersiveHelper';

// ─── TV event shim ────────────────────────────────────────────────────────────
type TVEventHandlerHook = (cb: (evt: { eventType: string }) => void) => void;
const _useTVEventHandler: TVEventHandlerHook | null = (() => {
  try { return require('react-native').useTVEventHandler ?? null; } catch { return null; }
})();
const _noopHook: TVEventHandlerHook = (_cb) => { useEffect(() => {}, []); };
const useSafeTVEvents = _useTVEventHandler ?? _noopHook;
// ─────────────────────────────────────────────────────────────────────────────

type AdvancedUIScreenNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  'AdvancedUI'
>;

interface Props {
  navigation: AdvancedUIScreenNavigationProp;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const isTV = Platform.isTV;

const PORTRAIT_COLS        = isTV ? 4 : 2;
const LANDSCAPE_COLS       = isTV ? 5 : 4;
const NOW_PLAYING_REC_COLS = isTV ? 4 : 3;

const VIDEO_ASPECT_RATIO = 16 / 9;

// ─────────────────────────────────────────────────────────────────────────────
// ChannelCard  (unchanged)
// ─────────────────────────────────────────────────────────────────────────────
interface CardProps {
  channel: Channel;
  isActive: boolean;
  cardWidth: number;
  onPress: () => void;
}

const ChannelCard: React.FC<CardProps> = React.memo(
  ({ channel, isActive, cardWidth, onPress }) => {
    const [isFocused, setIsFocused] = useState(false);
    const [isPressed, setIsPressed] = useState(false);
    const scaleAnim = useRef(new Animated.Value(1)).current;

    const handlePressIn = useCallback(() => {
      setIsPressed(true);
      Animated.spring(scaleAnim, {
        toValue: 0.93,
        useNativeDriver: true,
        speed: 30,
        bounciness: 4,
      }).start();
    }, [scaleAnim]);

    const handlePressOut = useCallback(() => {
      setIsPressed(false);
      Animated.spring(scaleAnim, {
        toValue: 1,
        useNativeDriver: true,
        speed: 20,
        bounciness: 6,
      }).start();
    }, [scaleAnim]);

    const cardH = Math.round(cardWidth * 0.72);
    const hasLogo = !!channel.logo;

    return (
      <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
        <Pressable
          focusable
          hasTVPreferredFocus={false}
          style={[
            cardStyles.card,
            { width: cardWidth, height: cardH },
            isActive   && cardStyles.cardActive,
            isFocused  && !isActive && cardStyles.cardFocused,
            isFocused  && isActive  && cardStyles.cardFocusedActive,
            isPressed  && cardStyles.cardPressed,
          ]}
          onPress={onPress}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          accessible
          accessibilityLabel={`Channel ${channel.number}: ${channel.name}`}
          accessibilityRole="button"
          accessibilityState={{ selected: isActive }}
        >
          {(isActive || isFocused) && (
            <View
              style={[
                cardStyles.glowRing,
                isActive  && cardStyles.glowRingActive,
                isFocused && !isActive && cardStyles.glowRingFocused,
              ]}
            />
          )}

          <View style={[cardStyles.logoBox, { height: cardH - 40 }]}>
            {hasLogo ? (
              <Image
                source={{ uri: channel.logo }}
                style={cardStyles.logo}
                resizeMode="contain"
              />
            ) : (
              <View style={cardStyles.logoFallback}>
                <Icon
                  name="television-play"
                  size={isTV ? 32 : 28}
                  color={isActive ? '#60a5fa' : '#1e3a5f'}
                />
                <Text style={[cardStyles.logoInitials, isActive && cardStyles.logoInitialsActive]}>
                  {channel.name.slice(0, 3).toUpperCase()}
                </Text>
              </View>
            )}

            {channel.isHD && (
              <View style={[cardStyles.hdBadge, isActive && cardStyles.hdBadgeActive]}>
                <Text style={cardStyles.hdText}>HD</Text>
              </View>
            )}

            {channel.isFavorite && (
              <View style={cardStyles.starBadge}>
                <Icon name="star" size={10} color={isActive ? '#fbbf24' : '#78350f'} />
              </View>
            )}
          </View>

          <View style={[cardStyles.nameStrip, isActive && cardStyles.nameStripActive]}>
            <Text
              style={[cardStyles.channelName, isActive && cardStyles.channelNameActive]}
              numberOfLines={1}
            >
              {channel.name}
            </Text>
          </View>
        </Pressable>
      </Animated.View>
    );
  },
);

const cardStyles = StyleSheet.create({
  card: {
    borderRadius: 16,
    backgroundColor: 'rgba(10,15,30,0.85)',
    borderWidth: 1.5,
    borderColor: 'rgba(30,41,59,0.9)',
    overflow: 'hidden',
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 5,
  },
  cardActive: {
    borderColor: '#3b82f6',
    borderWidth: 2,
    backgroundColor: 'rgba(29,78,216,0.15)',
    shadowColor: '#3b82f6',
    shadowOpacity: 0.55,
    shadowRadius: 12,
    elevation: 9,
  },
  cardFocused: {
    borderColor: '#818cf8',
    borderWidth: 2,
    backgroundColor: 'rgba(99,102,241,0.12)',
    shadowColor: '#818cf8',
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 8,
  },
  cardFocusedActive: {
    borderColor: '#60a5fa',
    borderWidth: 2.5,
    backgroundColor: 'rgba(29,78,216,0.25)',
    shadowColor: '#60a5fa',
    shadowOpacity: 0.6,
    shadowRadius: 14,
    elevation: 11,
  },
  cardPressed: {
    borderColor: '#93c5fd',
    backgroundColor: 'rgba(59,130,246,0.22)',
  },
  glowRing: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  glowRingActive:  { borderColor: 'rgba(59,130,246,0.35)' },
  glowRingFocused: { borderColor: 'rgba(129,140,248,0.30)' },

  logoBox: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(3,7,18,0.7)',
    position: 'relative',
  },
  logo: { width: '80%', height: '75%' },
  logoFallback: { alignItems: 'center', justifyContent: 'center', gap: 5 },
  logoInitials: {
    fontSize: isTV ? 12 : 10,
    fontWeight: '800',
    color: '#1e3a5f',
    letterSpacing: 1,
  },
  logoInitialsActive: { color: '#60a5fa' },

  hdBadge: {
    position: 'absolute',
    top: 6,
    right: 7,
    backgroundColor: 'rgba(30,64,175,0.5)',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: '#1e3a8a',
  },
  hdBadgeActive: { backgroundColor: '#1d4ed8', borderColor: '#3b82f6' },
  hdText: { color: '#93c5fd', fontSize: 8, fontWeight: '900', letterSpacing: 0.5 },

  starBadge: { position: 'absolute', bottom: 6, right: 7 },

  nameStrip: {
    height: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    backgroundColor: 'rgba(5,10,25,0.95)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(30,41,59,0.8)',
  },
  nameStripActive: {
    backgroundColor: 'rgba(15,30,70,0.95)',
    borderTopColor: 'rgba(59,130,246,0.4)',
  },
  channelName: {
    fontSize: isTV ? 13 : 12,
    fontWeight: '700',
    color: '#94a3b8',
    letterSpacing: 0.1,
    textAlign: 'center',
  },
  channelNameActive: { color: '#e2e8f0' },
});

// ─────────────────────────────────────────────────────────────────────────────
// SectionHeader  (unchanged)
// ─────────────────────────────────────────────────────────────────────────────
const SectionHeader: React.FC<{
  icon: string;
  iconColor: string;
  title: string;
  count?: number;
  badge?: string;
}> = ({ icon, iconColor, title, count, badge }) => (
  <View style={sectionHeaderStyles.row}>
    <View style={[sectionHeaderStyles.iconWrap, { borderColor: iconColor + '55' }]}>
      <Icon name={icon} size={13} color={iconColor} />
    </View>
    <Text style={sectionHeaderStyles.title}>{title}</Text>
    {count !== undefined && (
      <View style={sectionHeaderStyles.countBadge}>
        <Text style={sectionHeaderStyles.countText}>{count}</Text>
      </View>
    )}
    {badge && (
      <View style={[sectionHeaderStyles.textBadge, { borderColor: iconColor + '66' }]}>
        <Text style={[sectionHeaderStyles.textBadgeText, { color: iconColor }]}>
          {badge}
        </Text>
      </View>
    )}
    <View style={sectionHeaderStyles.line} />
  </View>
);

const sectionHeaderStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
  },
  iconWrap: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(3,7,18,0.8)',
  },
  title: {
    fontSize: isTV ? 12 : 11,
    fontWeight: '800',
    color: '#475569',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  countBadge: {
    backgroundColor: 'rgba(30,41,59,0.9)',
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  countText: { fontSize: 10, color: '#64748b', fontWeight: '700' },
  textBadge: {
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 1,
    backgroundColor: 'rgba(3,7,18,0.7)',
  },
  textBadgeText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  line: { flex: 1, height: 1, backgroundColor: '#0f172a' },
});

// ─────────────────────────────────────────────────────────────────────────────
// FilterChips  (unchanged)
// ─────────────────────────────────────────────────────────────────────────────
const LANGUAGES = [
  'All','Hindi','English','Marathi','Bengali','Telugu',
  'Tamil','Kannada','Gujarati','Odia','Malayalam','Punjabi',
];
const GENRES = [
  'All','Entertainment','Movies','Sports','News','Kids',
  'Lifestyle','Music','Devotional','Business News','Comedy',
];

interface FilterChipsProps {
  selectedLanguage: string;
  selectedGenre: string;
  onLanguageChange: (l: string) => void;
  onGenreChange: (g: string) => void;
}

const FilterChips: React.FC<FilterChipsProps> = ({
  selectedLanguage, selectedGenre, onLanguageChange, onGenreChange,
}) => (
  <View style={chipStyles.wrapper}>
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={chipStyles.row}
      keyboardShouldPersistTaps="always"
    >
      <View style={chipStyles.rowLabel}>
        <Icon name="translate" size={10} color="#3b82f6" />
      </View>
      {LANGUAGES.map(lang => (
        <Pressable
          key={lang}
          style={[chipStyles.chip, selectedLanguage === lang && chipStyles.chipLangActive]}
          onPress={() => onLanguageChange(lang)}
        >
          <Text style={[chipStyles.chipText, selectedLanguage === lang && chipStyles.chipTextActive]}>
            {lang}
          </Text>
        </Pressable>
      ))}
    </ScrollView>

    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={chipStyles.row}
      keyboardShouldPersistTaps="always"
    >
      <View style={chipStyles.rowLabel}>
        <Icon name="filmstrip" size={10} color="#8b5cf6" />
      </View>
      {GENRES.map(genre => (
        <Pressable
          key={genre}
          style={[chipStyles.chip, selectedGenre === genre && chipStyles.chipGenreActive]}
          onPress={() => onGenreChange(genre)}
        >
          <Text style={[chipStyles.chipText, selectedGenre === genre && chipStyles.chipTextActive]}>
            {genre}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  </View>
);

const chipStyles = StyleSheet.create({
  wrapper: {
    backgroundColor: 'rgba(3,7,18,0.98)',
    borderBottomWidth: 1,
    borderBottomColor: '#0f172a',
    paddingVertical: 5,
  },
  row: { flexGrow: 0, paddingHorizontal: 10, paddingVertical: 3 },
  rowLabel: { width: 22, alignItems: 'center', justifyContent: 'center', marginRight: 6 },
  chip: {
    paddingHorizontal: 13,
    paddingVertical: 6,
    backgroundColor: 'rgba(15,23,42,0.8)',
    borderRadius: 20,
    marginRight: 6,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  chipLangActive: { backgroundColor: 'rgba(29,78,216,0.25)', borderColor: '#3b82f6' },
  chipGenreActive: { backgroundColor: 'rgba(109,40,217,0.25)', borderColor: '#8b5cf6' },
  chipText: { color: '#475569', fontSize: 11, fontWeight: '500' },
  chipTextActive: { color: '#fff', fontWeight: '700' },
});

// ─────────────────────────────────────────────────────────────────────────────
// AdvancedUIScreen — main
// ─────────────────────────────────────────────────────────────────────────────
const AdvancedUIScreen: React.FC<Props> = ({ navigation }) => {
  const { channels, filteredChannels, setCurrentChannel, currentChannel } =
    useChannelContext();
  const { isLandscape, width, height } = useOrientation();

  const STATUS_BAR_HEIGHT = Platform.select({
    android: StatusBar.currentHeight ?? 0,
    ios: 20,
    default: 0,
  }) || 0;

  // ── Filters ───────────────────────────────────────────────────────────────
  const [selectedLanguage, setSelectedLanguage] = useState('All');
  const [selectedGenre,    setSelectedGenre]    = useState('All');

  const displayChannels = useMemo(() =>
    filteredChannels.filter(ch => {
      const lang  = ch.language ?? '';
      const genre = ch.excelGenre || ch.group || '';
      return (
        (selectedLanguage === 'All' || lang  === selectedLanguage) &&
        (selectedGenre    === 'All' || genre === selectedGenre)
      );
    }),
  [filteredChannels, selectedLanguage, selectedGenre]);

  // ── Playing state ─────────────────────────────────────────────────────────
  const [playingChannel, setPlayingChannel] = useState<Channel | null>(null);

  // "Now Playing" sub-page (portrait, embedded player at top of the page)
  const [isNowPlayingPage, setIsNowPlayingPage] = useState(false);

  // Manual fullscreen toggle (phone only). Physical rotation to landscape
  // reaches the same fullscreen UI via `isLandscape` below — the two are
  // merged into ONE fullscreen experience on purpose (see note at top of
  // file) so there is only ever one place that needs to show a full-bleed
  // player, instead of the old "landscape overlay" vs "fullscreen modal"
  // pair that fought over which player instance was mounted.
  const [manualFullscreen, setManualFullscreen] = useState(false);

  // Cosmetic only — gates the black cover + control fade-in while the native
  // orientation lock settles. It NEVER gates whether <VideoPlayer> is mounted,
  // and (as of the fix above) never gates the exit-fullscreen button either.
  const [chromeSettled, setChromeSettled] = useState(true);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const armSettleDelay = useCallback((ms: number) => {
    setChromeSettled(false);
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => setChromeSettled(true), ms);
  }, []);

  useEffect(() => () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
  }, []);

  // ── Play/pause (shared between mini view, fullscreen, and TV) ────────────
  const [isPaused, setIsPaused] = useState(false);
  const togglePause = useCallback(() => setIsPaused(p => !p), []);

  // ── TV D-pad focus wiring ─────────────────────────────────────────────────
  const exitBtnRef = useRef<any>(null);
  const playPauseRef = useRef<any>(null);
  const [exitBtnTag, setExitBtnTag] = useState<number | null>(null);

  // True whenever the phone should show the immersive full-bleed player —
  // whether the user pressed the fullscreen button OR the device is
  // physically rotated to landscape. TV never uses this path; TV has its
  // own always-on overlay chrome further below.
  const fullscreenActive = !isTV && !!playingChannel && (manualFullscreen || isLandscape);

  const enterFullscreen = useCallback(() => {
    setChromeSettled(false);
    lockToLandscape();
    setManualFullscreen(true);
  }, []);

  const exitFullscreen = useCallback(() => {
    armSettleDelay(250);
    setManualFullscreen(false);
    exitImmersive();
    lockToPortrait();
  }, [armSettleDelay]);

  // Reset pause state whenever the channel changes.
  useEffect(() => { setIsPaused(false); }, [playingChannel?.id]);

  // Hide the 3-button nav bar while fullscreen (immersive, swipe-to-reveal);
  // restore it the rest of the time.
  useEffect(() => {
    if (fullscreenActive) {
      enterImmersive();
    } else {
      exitImmersive();
    }
  }, [fullscreenActive]);

  // Safety net: make sure the nav bar is restored if this screen unmounts
  // while still in fullscreen (e.g. user navigates away via some other path).
  useEffect(() => () => exitImmersive(), []);

  // If the phone rotates to landscape organically (no button press) while a
  // channel is playing, still run the settle delay so controls fade in
  // smoothly instead of popping — purely cosmetic, player stays mounted.
  useEffect(() => {
    if (fullscreenActive && isLandscape) {
      const t = setTimeout(() => setChromeSettled(true), 80);
      return () => clearTimeout(t);
    }
    if (!fullscreenActive) {
      setChromeSettled(true);
    }
  }, [fullscreenActive, isLandscape]);

  // TV: track the exit button's native node handle so the play/pause button
  // can route D-pad Up straight to it via nextFocusUp.
  useEffect(() => {
    if (exitBtnRef.current) {
      setExitBtnTag(findNodeHandle(exitBtnRef.current));
    }
  }, [fullscreenActive, isTV]);

  // ── Channel selection ──────────────────────────────────────────────────────
  const handleChannelSelect = useCallback((channel: Channel) => {
    setCurrentChannel(channel);
    setPlayingChannel(channel);
    if (!isTV) setIsNowPlayingPage(true);
  }, [setCurrentChannel]);

  // ── Unified back handling ──────────────────────────────────────────────────
  //   • In fullscreen           → exit fullscreen, return to Now Playing
  //   • In Now Playing (portrait)→ return to grid (playingChannel kept so the
  //                                grid still shows which card is active)
  const handleBack = useCallback(() => {
    if (fullscreenActive) {
      exitFullscreen();
      return;
    }
    setIsNowPlayingPage(false);
  }, [fullscreenActive, exitFullscreen]);

  useEffect(() => {
    if (!isNowPlayingPage && !fullscreenActive) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      handleBack();
      return true;
    });
    return () => sub.remove();
  }, [isNowPlayingPage, fullscreenActive, handleBack]);

  // ── Landscape/fullscreen controls auto-hide ───────────────────────────────
  // NOTE: this only gates the *auto-hiding* chrome (channel-name pill, TV top
  // bar, and now the center play/pause button in fullscreen/TV). The
  // exit-fullscreen button is intentionally independent of this — see the
  // fix note at the top of the file.
  const [showControls, setShowControls] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetControlsHideTimer = useCallback(() => {
    setShowControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShowControls(false), 4500);
  }, []);

  useEffect(() => {
    if ((fullscreenActive || isTV) && playingChannel) resetControlsHideTimer();
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, [fullscreenActive, isTV, playingChannel, resetControlsHideTimer]);

  useSafeTVEvents(resetControlsHideTimer);

  // ── Dimensions ────────────────────────────────────────────────────────────
  const cols      = isLandscape || isTV ? LANDSCAPE_COLS : PORTRAIT_COLS;
  const GRID_PADDING = 12;
  const CARD_GAP     = 10;
  const cardWidth = Math.floor(
    (width - GRID_PADDING * 2 - CARD_GAP * (cols - 1)) / cols,
  );

  const recCols       = NOW_PLAYING_REC_COLS;
  const recCardWidth  = Math.floor(
    (width - GRID_PADDING * 2 - CARD_GAP * (recCols - 1)) / recCols,
  );

  const videoNowPlayingH = Math.min(
    Math.round(width / VIDEO_ASPECT_RATIO),
    Math.round(height * 0.5),
  );

  // ── Video key — this is what identifies the player instance to React.
  // It only changes when the channel itself changes, NEVER when switching
  // between Now Playing / landscape / fullscreen / TV chrome.
  const baseKey = playingChannel
    ? `${playingChannel.id}-${playingChannel.streamUrl}`
    : 'none';

  // ── Recommended channels (Now Playing page only — NOT shown once
  // fullscreen/TV playback starts; see fix note at top of file) ─────────────
  const recommendedChannels = useMemo(() => {
    if (!playingChannel) return displayChannels.slice(0, 6);
    return displayChannels
      .filter(ch => ch.id !== playingChannel.id)
      .slice(0, 6);
  }, [displayChannels, playingChannel]);

  // ── Grid renderers ─────────────────────────────────────────────────────────
  const renderCard = useCallback(
    ({ item }: { item: Channel }) => (
      <View style={{ marginBottom: CARD_GAP }}>
        <ChannelCard
          channel={item}
          isActive={playingChannel?.id === item.id}
          cardWidth={cardWidth}
          onPress={() => handleChannelSelect(item)}
        />
      </View>
    ),
    [cardWidth, playingChannel, handleChannelSelect],
  );

  const renderRecCard = useCallback(
    ({ item }: { item: Channel }) => (
      <View style={{ marginBottom: CARD_GAP }}>
        <ChannelCard
          channel={item}
          isActive={playingChannel?.id === item.id}
          cardWidth={recCardWidth}
          onPress={() => handleChannelSelect(item)}
        />
      </View>
    ),
    [recCardWidth, playingChannel, handleChannelSelect],
  );

  const keyExtractor = useCallback(
    (item: Channel, index: number) => String(item.id ?? `ch-${index}`),
    [],
  );

  const getItemLayout = useCallback(
    (_: any, index: number) => {
      const rowH = Math.round(cardWidth * 0.72) + CARD_GAP;
      const row  = Math.floor(index / cols);
      return { length: rowH, offset: rowH * row, index };
    },
    [cardWidth, cols],
  );

  const getRecItemLayout = useCallback(
    (_: any, index: number) => {
      const rowH = Math.round(recCardWidth * 0.72) + CARD_GAP;
      const row  = Math.floor(index / recCols);
      return { length: rowH, offset: rowH * row, index };
    },
    [recCardWidth, recCols],
  );

  const isPortraitPhone = !isTV && !isLandscape;

  // Should the single player be mounted at all right now?
  const showPlayer = !!playingChannel && (isTV || isNowPlayingPage || fullscreenActive);

  // Container style for the ONE player wrapper — this is the only thing that
  // changes shape between states; the <VideoPlayer> inside never remounts
  // because of it.
  const playerContainerStyle = useMemo(() => {
    if (isTV || fullscreenActive) {
      return StyleSheet.absoluteFillObject as any;
    }
    // Embedded "Now Playing" rectangle (portrait phone). `marginTop` clears
    // the translucent status bar — this is the top-most element on the Now
    // Playing page, so without it the top sliver of the video was drawn
    // underneath the status bar.
    return {
      width: '100%',
      height: videoNowPlayingH,
      backgroundColor: '#000',
      position: 'relative' as const,
      marginTop: STATUS_BAR_HEIGHT,
    };
  }, [isTV, fullscreenActive, videoNowPlayingH, STATUS_BAR_HEIGHT]);

  // Should the shared center play/pause button render right now?
  // Mini "Now Playing" view: always (no auto-hide there).
  // Fullscreen / TV: only while the auto-hiding chrome is shown.
  const showCenterPlayPause =
    isNowPlayingPage || fullscreenActive || isTV
      ? (fullscreenActive || isTV ? showControls : true)
      : false;

  // ════════════════════════════════════════════════════════════════════════
  // Single render tree — no more early-return branches per orientation/mode.
  // Chrome (grid / controls / mini-row) is layered conditionally; the player
  // wrapper below is always in the same JSX position when `showPlayer` is
  // true.
  // ════════════════════════════════════════════════════════════════════════
  return (
    <View style={styles.root}>
      <StatusBar
        barStyle="light-content"
        backgroundColor="transparent"
        translucent
        hidden={fullscreenActive}
      />

      {/* ── THE single persistent player ─────────────────────────────────── */}
      {showPlayer && (
        <View
          style={playerContainerStyle}
          pointerEvents="box-none"
          renderToHardwareTextureAndroid
        >
          <VideoPlayer
            key={baseKey}
            channel={playingChannel as Channel}
            fullscreen={fullscreenActive}
            paused={isPaused}
            onFullscreenDismiss={exitFullscreen}
          />

          {/* Tap target to reveal controls again (fullscreen / TV only) */}
          {(fullscreenActive || isTV) && (
            <Pressable
              style={[StyleSheet.absoluteFill, { zIndex: showControls ? 1 : 10 }]}
              onPress={resetControlsHideTimer}
            />
          )}

          {/* ── Center play/pause — mini view, fullscreen, and TV ─────────
              Shared across all three contexts via the single `isPaused`
              state above, which is what's actually passed to VideoPlayer. */}
          {showCenterPlayPause && (
            <Pressable
              ref={playPauseRef}
              style={npStyles.centerPlayBtn}
              onPress={togglePause}
              hasTVPreferredFocus={isTV}
              nextFocusUp={exitBtnTag ?? undefined}
              accessibilityLabel={isPaused ? 'Play' : 'Pause'}
              accessibilityRole="button"
              hitSlop={10}
            >
              <Icon name={isPaused ? 'play' : 'pause'} size={32} color="#fff" />
            </Pressable>
          )}

          {/* Fullscreen-entry button — only shown embedded in Now Playing */}
          {isNowPlayingPage && !fullscreenActive && !isTV && (
            <Pressable
              style={npStyles.fsToggleBtn}
              onPress={enterFullscreen}
              hitSlop={10}
              accessibilityLabel="Enter fullscreen"
              accessibilityRole="button"
            >
              <Icon name="fullscreen" size={20} color="#fff" />
            </Pressable>
          )}

          {/* ── Exit-fullscreen button (phone) ────────────────────────────
              Always rendered while fullscreenActive — independent of the
              auto-hide controls timer and the rotation-settle cover — so
              it's never missing or briefly untappable. Only its opacity
              fades in once chromeSettled confirms the real landscape frame
              has arrived, so it's never laid out against a stale bounds. */}
          {fullscreenActive && (
            <TouchableOpacity
              ref={exitBtnRef}
              style={[
                fsStyles.exitBtn,
                !chromeSettled && { opacity: 0 },
              ]}
              onPress={exitFullscreen}
              accessibilityLabel="Exit fullscreen"
              accessibilityRole="button"
              hitSlop={8}
            >
              <Icon name="fullscreen-exit" size={22} color="#fff" />
            </TouchableOpacity>
          )}

          {/* ── Immersive fullscreen chrome (phone) ───────────────────────
              Channel name only — no "switch channel" list. Fullscreen means
              just the video, full-bleed, undistracted. */}
          {fullscreenActive && chromeSettled && showControls && (
            <View style={fsStyles.topPill}>
              <Text style={fsStyles.pillChName} numberOfLines={1}>
                {playingChannel?.name}
              </Text>
              {playingChannel?.isHD && (
                <View style={fsStyles.hdBadge}>
                  <Text style={fsStyles.hdText}>HD</Text>
                </View>
              )}
            </View>
          )}

          {/* ── TV overlay chrome ──────────────────────────────────────────
              Name + settings only — no channel grid while a channel is
              already streaming. Full-bleed playback, same as phone
              fullscreen above. */}
          {isTV && showControls && (
            <View style={styles.lsOverlay}>
              <View style={[styles.lsTopBar, { paddingTop: STATUS_BAR_HEIGHT + 4 }]}>
                <View style={styles.lsTopLeft}>
                  <View style={styles.logoIcon}>
                    <Icon name="grid" size={22} color="#fff" />
                  </View>
                  <View>
                    <Text style={styles.lsAppName}>{APP_CONFIG.APP_NAME}</Text>
                    <Text style={styles.lsMode}>Advanced Mode</Text>
                  </View>
                </View>
                <View style={styles.lsTopRight}>
                  {playingChannel && (
                    <View style={styles.lsChannelBadge}>
                      <Text style={styles.lsChName} numberOfLines={1}>{playingChannel.name}</Text>
                    </View>
                  )}
                  <Pressable
                    style={styles.lsIconBtn}
                    onPress={() => navigation.navigate('Selection')}
                  >
                    <Icon name="cog-outline" size={22} color="#94a3b8" />
                  </Pressable>
                </View>
              </View>
            </View>
          )}

          {!chromeSettled && (fullscreenActive) && (
            <View style={fsStyles.settleCover} pointerEvents="none" />
          )}
        </View>
      )}

      {isTV && !playingChannel && (
        <View style={StyleSheet.absoluteFill}>
          <NoChannelPlaceholder />
        </View>
      )}

      {/* ── Portrait phone: Now Playing info + Up Next (below the player) ─── */}
      {isPortraitPhone && isNowPlayingPage && playingChannel && !fullscreenActive && (
        <>
          <View style={npStyles.infoStrip}>
            <View style={npStyles.infoLeft}>
              <Text style={npStyles.infoName}>{playingChannel.name}</Text>
              {playingChannel.language ? (
                <Text style={npStyles.infoMeta}>{playingChannel.language}</Text>
              ) : null}
            </View>
            {playingChannel.isFavorite && (
              <View style={npStyles.favBadge}>
                <Icon name="star" size={11} color="#fbbf24" />
                <Text style={npStyles.favText}>Favourite</Text>
              </View>
            )}
          </View>

          <ScrollView style={npStyles.scrollArea} showsVerticalScrollIndicator={false}>
            <SectionHeader
              icon="television-play"
              iconColor="#22c55e"
              title="Up Next"
              count={recommendedChannels.length}
            />
            <FlatList
              data={recommendedChannels}
              renderItem={renderRecCard}
              keyExtractor={keyExtractor}
              numColumns={recCols}
              columnWrapperStyle={{ gap: CARD_GAP }}
              contentContainerStyle={{ paddingHorizontal: GRID_PADDING, paddingBottom: 28 }}
              scrollEnabled={false}
              getItemLayout={getRecItemLayout}
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <Icon name="television-off" size={36} color="#1e293b" />
                  <Text style={styles.emptyTitle}>No recommendations</Text>
                </View>
              }
            />
          </ScrollView>
        </>
      )}

      {/* ── Portrait phone: main grid page ─────────────────────────────────── */}
      {isPortraitPhone && !isNowPlayingPage && (
        <>
          <View style={[styles.header, { paddingTop: STATUS_BAR_HEIGHT + 6 }]}>
            <View style={styles.headerLeft}>
              <View style={styles.logoIcon}>
                <Icon name="grid" size={16} color="#fff" />
              </View>
              <View>
                <Text style={styles.appName}>{APP_CONFIG.APP_NAME}</Text>
                <Text style={styles.modeLabel}>Advanced Mode</Text>
              </View>
            </View>
            <View style={styles.headerRight}>
              <View style={styles.countBadge}>
                <Text style={styles.countNum}>{displayChannels.length}</Text>
                <Text style={styles.countLabel}>ch</Text>
              </View>
              <Pressable
                style={styles.headerIconBtn}
                onPress={() => navigation.navigate('Selection')}
              >
                <Icon name="cog-outline" size={18} color="#94a3b8" />
              </Pressable>
            </View>
          </View>

          <FilterChips
            selectedLanguage={selectedLanguage}
            selectedGenre={selectedGenre}
            onLanguageChange={setSelectedLanguage}
            onGenreChange={setSelectedGenre}
          />

          <FlatList
            data={displayChannels}
            renderItem={renderCard}
            keyExtractor={keyExtractor}
            numColumns={PORTRAIT_COLS}
            columnWrapperStyle={{ gap: CARD_GAP }}
            contentContainerStyle={{
              paddingHorizontal: GRID_PADDING,
              paddingTop: 12,
              paddingBottom: 32,
            }}
            showsVerticalScrollIndicator={false}
            getItemLayout={getItemLayout}
            windowSize={7}
            maxToRenderPerBatch={10}
            initialNumToRender={10}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Icon name="television-off" size={46} color="#1e293b" />
                <Text style={styles.emptyTitle}>No channels found</Text>
                <Text style={styles.emptySubtitle}>
                  {selectedLanguage !== 'All' || selectedGenre !== 'All'
                    ? 'Try changing Language or Genre filter'
                    : 'Add channels via Settings'}
                </Text>
              </View>
            }
          />
        </>
      )}
    </View>
  );
};

// ─── NoChannelPlaceholder ─────────────────────────────────────────────────────
const NoChannelPlaceholder: React.FC = () => (
  <View style={placeholderStyles.container}>
    <Icon name="television-off" size={isTV ? 100 : 56} color="#1e293b" />
    <Text style={[placeholderStyles.text, isTV && placeholderStyles.tvText]}>
      Select a Channel
    </Text>
    <Text style={placeholderStyles.sub}>Tap any channel card to start watching</Text>
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
  text:   { fontSize: 18, color: '#1f2937', fontWeight: '700' },
  tvText: { fontSize: 26 },
  sub:    { fontSize: 12, color: '#111827' },
});

// ─── Now Playing styles ───────────────────────────────────────────────────────
const npStyles = StyleSheet.create({
  centerPlayBtn: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -28,
    marginTop: -28,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    zIndex: 25,
    elevation: 25,
  },

  fsToggleBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    padding: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    zIndex: 10,
  },

  infoStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: 'rgba(5,10,25,0.98)',
    borderBottomWidth: 1,
    borderBottomColor: '#0f172a',
  },
  infoLeft: { flex: 1 },
  infoName: { fontSize: 17, fontWeight: '800', color: '#f1f5f9' },
  infoMeta: { fontSize: 11, color: '#64748b', marginTop: 3, fontWeight: '500' },
  favBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(146,64,14,0.2)',
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.3)',
  },
  favText: { fontSize: 10, fontWeight: '700', color: '#fbbf24' },

  scrollArea: { flex: 1 },
});

// ─── Root styles ──────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#030712' },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingBottom: 10,
    backgroundColor: 'rgba(3,7,18,0.98)',
    borderBottomWidth: 1,
    borderBottomColor: '#0f172a',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logoIcon: {
    backgroundColor: '#1d4ed8',
    padding: 8,
    borderRadius: 10,
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 8,
    elevation: 6,
  },
  appName:   { fontSize: 15, fontWeight: '900', color: '#f1f5f9', letterSpacing: 0.3 },
  modeLabel: { fontSize: 9, color: '#334155', fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.8 },

  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  countBadge: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 3,
    backgroundColor: 'rgba(29,78,216,0.18)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#1d4ed8',
  },
  countNum:   { fontSize: 16, fontWeight: '900', color: '#60a5fa' },
  countLabel: { fontSize: 9, fontWeight: '700', color: '#3b82f6', textTransform: 'uppercase' },
  headerIconBtn: {
    backgroundColor: 'rgba(30,41,59,0.8)',
    padding: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },

  // TV overlay
  lsOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 5, justifyContent: 'flex-start' },
  lsTopBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingBottom: 10,
    backgroundColor: 'rgba(3,7,18,0.88)',
    borderBottomWidth: 1,
    borderBottomColor: '#0f172a',
  },
  lsTopLeft:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  lsTopRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  lsAppName:  { fontSize: 18, fontWeight: '900', color: '#f1f5f9' },
  lsMode:     { fontSize: 9, color: '#334155', fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.8 },
  lsChannelBadge: { alignItems: 'flex-end' },
  lsChName:   { fontSize: 13, fontWeight: '700', color: '#e2e8f0', maxWidth: 160 },
  lsIconBtn: {
    backgroundColor: 'rgba(30,41,59,0.8)',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },

  // Empty state
  emptyState: { alignItems: 'center', paddingVertical: 48, gap: 10 },
  emptyTitle:    { fontSize: 15, color: '#374151', fontWeight: '700' },
  emptySubtitle: { fontSize: 12, color: '#1f2937', textAlign: 'center', paddingHorizontal: 20 },
});

// ─── Fullscreen chrome styles ───────────────────────────────────────────────────
const fsStyles = StyleSheet.create({
  exitBtn: {
    position: 'absolute',
    top: 14,
    right: 14,
    backgroundColor: 'rgba(0,0,0,0.65)',
    padding: 9,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    zIndex: 30,
    elevation: 30,
  },

  topPill: {
    position: 'absolute',
    top: 14,
    left: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: 'rgba(3,7,18,0.78)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.3)',
    zIndex: 20,
    maxWidth: '55%',
  },
  pillChName: { fontSize: 13, fontWeight: '700', color: '#e2e8f0', flexShrink: 1 },
  hdBadge: {
    backgroundColor: '#1d4ed8',
    borderRadius: 3,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: '#3b82f6',
  },
  hdText: { color: '#93c5fd', fontSize: 7, fontWeight: '900', letterSpacing: 0.5 },

  // Purely cosmetic cover shown for ~250-300ms while the native orientation
  // lock settles, so the user doesn't see a rotation jump. Sits ON TOP of
  // the already-mounted, already-playing <VideoPlayer> — it does not gate
  // the player's existence the way the old `fullscreenReady` flag did.
  settleCover: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
    zIndex: 15,
  },
});

export default AdvancedUIScreen;