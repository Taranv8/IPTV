// src/screens/advanced/AdvancedUIScreen.tsx
//
// Advanced UI — channel grid with:
//   • Portrait  → 2-col grid; selecting a channel opens a YouTube-style
//                 "Now Playing" sub-page (back → returns to grid)
//   • Landscape → full-screen player overlay + mini channel row at bottom
//   • Fullscreen modal → 5 mini channel cards in one row near bottom controls
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
  Modal,
  Animated,
  Dimensions,
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

// ── Grid columns ──────────────────────────────────────────────────────────────
//   Portrait phone  → 2 cols (bigger cards, easier to tap)
//   Landscape phone → 4 cols
//   TV              → 5 cols
const PORTRAIT_COLS        = isTV ? 4 : 2;
const LANDSCAPE_COLS       = isTV ? 5 : 4;
const NOW_PLAYING_REC_COLS = isTV ? 4 : 3;   // recommended grid inside Now Playing

// Player height ratios
const VIDEO_PORTRAIT_HEIGHT_RATIO   = 0.38;  // ~38 % of screen height
const VIDEO_NOWPLAYING_HEIGHT_RATIO = 0.42;  // slightly taller on Now Playing page

// ─────────────────────────────────────────────────────────────────────────────
// ChannelCard
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

            <View style={cardStyles.liveDot}>
              <View style={[cardStyles.liveDotInner, isActive && cardStyles.liveDotActive]} />
            </View>

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
            <Text style={[cardStyles.channelNum, isActive && cardStyles.channelNumActive]}>
              {channel.number}
            </Text>
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
    borderRadius: 14,
    backgroundColor: 'rgba(10,15,30,0.85)',
    borderWidth: 1.5,
    borderColor: 'rgba(30,41,59,0.9)',
    overflow: 'hidden',
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 7,
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
    borderRadius: 14,
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

  liveDot: { position: 'absolute', top: 7, left: 8 },
  liveDotInner: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#374151' },
  liveDotActive: { backgroundColor: '#22c55e' },

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
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    gap: 6,
    backgroundColor: 'rgba(5,10,25,0.95)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(30,41,59,0.8)',
  },
  nameStripActive: {
    backgroundColor: 'rgba(15,30,70,0.95)',
    borderTopColor: 'rgba(59,130,246,0.4)',
  },
  channelNum: {
    fontSize: isTV ? 11 : 10,
    fontWeight: '800',
    color: '#1e3a5f',
    letterSpacing: 0.3,
    flexShrink: 0,
  },
  channelNumActive: { color: '#3b82f6' },
  channelName: {
    flex: 1,
    fontSize: isTV ? 12 : 11,
    fontWeight: '700',
    color: '#64748b',
    letterSpacing: 0.1,
  },
  channelNameActive: { color: '#e2e8f0' },
});

// ─────────────────────────────────────────────────────────────────────────────
// MiniChannelCard  — used in the fullscreen bottom row
// ─────────────────────────────────────────────────────────────────────────────
interface MiniCardProps {
  channel: Channel;
  isActive: boolean;
  onPress: () => void;
}

const MiniChannelCard: React.FC<MiniCardProps> = React.memo(({ channel, isActive, onPress }) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <Pressable
        style={[miniCardStyles.card, isActive && miniCardStyles.cardActive]}
        onPress={onPress}
        onPressIn={() =>
          Animated.spring(scaleAnim, { toValue: 0.9, useNativeDriver: true, speed: 30, bounciness: 4 }).start()
        }
        onPressOut={() =>
          Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 6 }).start()
        }
        accessibilityLabel={`Switch to ${channel.name}`}
      >
        <View style={miniCardStyles.logoArea}>
          {channel.logo ? (
            <Image source={{ uri: channel.logo }} style={miniCardStyles.logo} resizeMode="contain" />
          ) : (
            <Icon name="television-play" size={18} color={isActive ? '#60a5fa' : '#334155'} />
          )}
          {isActive && <View style={miniCardStyles.activeDot} />}
        </View>
        <Text style={[miniCardStyles.num, isActive && miniCardStyles.numActive]} numberOfLines={1}>
          {channel.number}
        </Text>
        <Text style={[miniCardStyles.name, isActive && miniCardStyles.nameActive]} numberOfLines={1}>
          {channel.name}
        </Text>
      </Pressable>
    </Animated.View>
  );
});

const miniCardStyles = StyleSheet.create({
  card: {
    width: 68,
    backgroundColor: 'rgba(5,10,25,0.88)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e293b',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 4,
    marginHorizontal: 4,
  },
  cardActive: {
    borderColor: '#3b82f6',
    backgroundColor: 'rgba(29,78,216,0.22)',
  },
  logoArea: {
    width: 44,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  logo: { width: 40, height: 28, borderRadius: 4 },
  activeDot: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#22c55e',
  },
  num: { fontSize: 9, fontWeight: '800', color: '#334155', marginTop: 4, letterSpacing: 0.4 },
  numActive: { color: '#60a5fa' },
  name: { fontSize: 9, fontWeight: '600', color: '#475569', textAlign: 'center' },
  nameActive: { color: '#cbd5e1' },
});

// ─────────────────────────────────────────────────────────────────────────────
// SectionHeader
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
// FilterChips
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

  // ── "Now Playing" sub-page (portrait only) ────────────────────────────────
  //    true  → renders the YouTube-style Now Playing page
  //    false → renders the main grid
  const [isNowPlayingPage, setIsNowPlayingPage] = useState(false);

  // ── Fullscreen modal ──────────────────────────────────────────────────────
  const [isFullscreenModal, setIsFullscreenModal]   = useState(false);
  const [fullscreenReady,   setFullscreenReady]      = useState(false);
  const fsReadyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const enterFullscreen = useCallback(() => {
    setFullscreenReady(false);
    lockToLandscape();
    setIsFullscreenModal(true);
    if (fsReadyTimer.current) clearTimeout(fsReadyTimer.current);
    fsReadyTimer.current = setTimeout(() => setFullscreenReady(true), 300);
  }, []);

  const exitFullscreen = useCallback(() => {
    setFullscreenReady(false);
    if (fsReadyTimer.current) clearTimeout(fsReadyTimer.current);
    setIsFullscreenModal(false);
    lockToPortrait();
  }, []);

  useEffect(() => () => {
    if (fsReadyTimer.current) clearTimeout(fsReadyTimer.current);
  }, []);

  // ── Landscape overlay controls auto-hide ─────────────────────────────────
  const [showLandscapeControls, setShowLandscapeControls] = useState(true);
  const landHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetLandscapeControls = useCallback(() => {
    setShowLandscapeControls(true);
    if (landHideTimer.current) clearTimeout(landHideTimer.current);
    landHideTimer.current = setTimeout(() => setShowLandscapeControls(false), 4000);
  }, []);

  useEffect(() => {
    if (isLandscape && playingChannel) resetLandscapeControls();
    return () => { if (landHideTimer.current) clearTimeout(landHideTimer.current); };
  }, [isLandscape, playingChannel, resetLandscapeControls]);

  useSafeTVEvents(resetLandscapeControls);

  // ── Fullscreen control visibility (separate timer) ────────────────────────
  const [showFsControls, setShowFsControls] = useState(true);
  const fsHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetFsControls = useCallback(() => {
    setShowFsControls(true);
    if (fsHideTimer.current) clearTimeout(fsHideTimer.current);
    fsHideTimer.current = setTimeout(() => setShowFsControls(false), 5000);
  }, []);

  useEffect(() => {
    if (isFullscreenModal && fullscreenReady) resetFsControls();
    return () => { if (fsHideTimer.current) clearTimeout(fsHideTimer.current); };
  }, [isFullscreenModal, fullscreenReady, resetFsControls]);

  // ── Channel selection ──────────────────────────────────────────────────────
  const handleChannelSelect = useCallback((channel: Channel) => {
    setCurrentChannel(channel);
    setPlayingChannel(channel);

    if (!isTV && isLandscape) {
      enterFullscreen();
    } else if (!isTV && !isLandscape) {
      // Portrait phone → open Now Playing sub-page
      setIsNowPlayingPage(true);
    }
  }, [isLandscape, setCurrentChannel, enterFullscreen]);

  // ── Back from Now Playing to grid ─────────────────────────────────────────
  const handleBackFromNowPlaying = useCallback(() => {
    setIsNowPlayingPage(false);
    // Keep playingChannel so state is preserved but we leave Now Playing
  }, []);

  // ── Dimensions ────────────────────────────────────────────────────────────
  const cols      = isLandscape || isTV ? LANDSCAPE_COLS : PORTRAIT_COLS;
  const GRID_PADDING = 12;
  const CARD_GAP     = 10;
  const cardWidth = Math.floor(
    (width - GRID_PADDING * 2 - CARD_GAP * (cols - 1)) / cols,
  );

  // Card width for Now Playing recommended grid (3 cols)
  const recCols       = NOW_PLAYING_REC_COLS;
  const recCardWidth  = Math.floor(
    (width - GRID_PADDING * 2 - CARD_GAP * (recCols - 1)) / recCols,
  );

  const videoNowPlayingH = Math.round(height * VIDEO_NOWPLAYING_HEIGHT_RATIO);
  const videoPortraitH   = Math.round(height * VIDEO_PORTRAIT_HEIGHT_RATIO);

  // ── Video keys ─────────────────────────────────────────────────────────────
  const baseKey       = playingChannel
    ? `${playingChannel.id}-${playingChannel.streamUrl}`
    : 'none';
  const nowPlayingKey = `adv-np-${baseKey}`;
  const fullscreenKey = `adv-fs-${baseKey}`;

  // ── Recommended channels ───────────────────────────────────────────────────
  const recommendedChannels = useMemo(() => {
    if (!playingChannel) return displayChannels.slice(0, 6);
    return displayChannels
      .filter(ch => ch.id !== playingChannel.id)
      .slice(0, 6);
  }, [displayChannels, playingChannel]);

  // First 5 for fullscreen row
  const fsChannelRow = useMemo(() => {
    if (!playingChannel) return displayChannels.slice(0, 5);
    return displayChannels
      .filter(ch => ch.id !== playingChannel.id)
      .slice(0, 5);
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

  // ════════════════════════════════════════════════════════════════════════════
  // LANDSCAPE PHONE / TV — full-screen video + overlay channel panel
  // ════════════════════════════════════════════════════════════════════════════
  if (!isPortraitPhone) {
    return (
      <View style={styles.root}>
        <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

        {playingChannel ? (
          <View style={StyleSheet.absoluteFill}>
            <VideoPlayer
              key={baseKey}
              channel={playingChannel}
              fullscreen={false}
              onFullscreenDismiss={() => {}}
            />
          </View>
        ) : (
          <View style={StyleSheet.absoluteFill}>
            <NoChannelPlaceholder />
          </View>
        )}

        <Pressable
          style={[StyleSheet.absoluteFill, { zIndex: showLandscapeControls ? 1 : 10 }]}
          onPress={resetLandscapeControls}
        />

        {showLandscapeControls && (
          <View style={styles.lsOverlay}>
            <View style={[styles.lsTopBar, { paddingTop: STATUS_BAR_HEIGHT + 4 }]}>
              <View style={styles.lsTopLeft}>
                <View style={styles.logoIcon}>
                  <Icon name="grid" size={isTV ? 22 : 16} color="#fff" />
                </View>
                <View>
                  <Text style={styles.lsAppName}>{APP_CONFIG.APP_NAME}</Text>
                  <Text style={styles.lsMode}>Advanced Mode</Text>
                </View>
              </View>
              <View style={styles.lsTopRight}>
                {playingChannel && (
                  <View style={styles.lsChannelBadge}>
                    <Text style={styles.lsChNum}>CH {playingChannel.number}</Text>
                    <Text style={styles.lsChName} numberOfLines={1}>{playingChannel.name}</Text>
                  </View>
                )}
                <Pressable
                  style={styles.lsIconBtn}
                  onPress={() => navigation.navigate('Selection')}
                >
                  <Icon name="cog-outline" size={isTV ? 22 : 18} color="#94a3b8" />
                </Pressable>
              </View>
            </View>

            <View style={styles.lsBottomPanel}>
              <SectionHeader
                icon="grid"
                iconColor="#3b82f6"
                title="Channels"
                count={displayChannels.length}
              />
              <FlatList
                data={displayChannels}
                renderItem={renderCard}
                keyExtractor={keyExtractor}
                getItemLayout={getItemLayout}
                numColumns={cols}
                columnWrapperStyle={{ gap: CARD_GAP }}
                contentContainerStyle={{ padding: GRID_PADDING }}
                showsVerticalScrollIndicator={false}
                style={{ maxHeight: 260 }}
                windowSize={5}
                maxToRenderPerBatch={12}
                initialNumToRender={12}
                onScroll={resetLandscapeControls}
                scrollEventThrottle={300}
              />
            </View>
          </View>
        )}
      </View>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PORTRAIT PHONE — NOW PLAYING PAGE
  //   Renders when a channel is selected; back button returns to main grid.
  // ════════════════════════════════════════════════════════════════════════════
  if (isPortraitPhone && isNowPlayingPage && playingChannel) {
    return (
      <View style={styles.root}>
        <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

        {/* ── Now Playing header / back bar ──────────────────────────────── */}
        <View style={[npStyles.header, { paddingTop: STATUS_BAR_HEIGHT + 6 }]}>
          <TouchableOpacity
            style={npStyles.backBtn}
            onPress={handleBackFromNowPlaying}
            accessibilityLabel="Back to channels"
          >
            <Icon name="arrow-left" size={20} color="#e2e8f0" />
          </TouchableOpacity>

          <View style={npStyles.headerInfo}>
            <Text style={npStyles.headerChNum}>CH {playingChannel.number}</Text>
            <Text style={npStyles.headerChName} numberOfLines={1}>
              {playingChannel.name}
            </Text>
            {playingChannel.isHD && (
              <View style={npStyles.hdBadge}>
                <Text style={npStyles.hdText}>HD</Text>
              </View>
            )}
          </View>

          {/* Fullscreen button */}
          <TouchableOpacity
            style={npStyles.headerActionBtn}
            onPress={enterFullscreen}
            accessibilityLabel="Enter fullscreen"
          >
            <Icon name="fullscreen" size={20} color="#94a3b8" />
          </TouchableOpacity>
        </View>

        {/* ── Video player ───────────────────────────────────────────────── */}
        <View style={[npStyles.playerWrap, { height: videoNowPlayingH }]}>
          <VideoPlayer
            key={nowPlayingKey}
            channel={playingChannel}
            fullscreen={false}
            onFullscreenDismiss={() => {}}
          />
          {/* Live badge */}
          <View style={npStyles.liveBadge}>
            <View style={npStyles.liveDot} />
            <Text style={npStyles.liveText}>LIVE</Text>
          </View>
        </View>

        {/* ── Channel info strip below player ────────────────────────────── */}
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
          {/* ── Recommended section ──────────────────────────────────────── */}
          <SectionHeader
            icon="television-play"
            iconColor="#22c55e"
            title="Up Next"
            count={recommendedChannels.length}
            badge="LIVE"
          />

          <FlatList
            data={recommendedChannels}
            renderItem={renderRecCard}
            keyExtractor={keyExtractor}
            numColumns={recCols}
            columnWrapperStyle={{ gap: CARD_GAP }}
            contentContainerStyle={{
              paddingHorizontal: GRID_PADDING,
              paddingBottom: 28,
            }}
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

        {/* ── Fullscreen modal ─────────────────────────────────────────────── */}
        {renderFullscreenModal()}
      </View>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PORTRAIT PHONE — MAIN GRID PAGE
  // ════════════════════════════════════════════════════════════════════════════
  function renderFullscreenModal() {
    return (
      <Modal
        visible={isFullscreenModal}
        transparent={false}
        animationType="fade"
        supportedOrientations={['landscape', 'landscape-left', 'landscape-right']}
        onRequestClose={exitFullscreen}
        statusBarTranslucent
      >
        <View style={fsStyles.container}>
          <StatusBar hidden />

          {/* Tap to show / hide controls */}
          <Pressable style={StyleSheet.absoluteFill} onPress={resetFsControls} />

          {playingChannel && fullscreenReady ? (
            <VideoPlayer
              key={fullscreenKey}
              channel={playingChannel}
              fullscreen={false}
              onFullscreenDismiss={exitFullscreen}
            />
          ) : (
            <View style={{ flex: 1, backgroundColor: '#000' }} />
          )}

          {/* Controls overlay */}
          {showFsControls && playingChannel && fullscreenReady && (
            <>
              {/* Exit fullscreen */}
              <TouchableOpacity
                style={fsStyles.exitBtn}
                onPress={exitFullscreen}
                accessibilityLabel="Exit fullscreen"
              >
                <Icon name="fullscreen-exit" size={22} color="#fff" />
              </TouchableOpacity>

              {/* Channel name + live pill (top left) */}
              <View style={fsStyles.topPill}>
                <View style={fsStyles.liveDot} />
                <Text style={fsStyles.pillChNum}>CH {playingChannel.number}</Text>
                <Text style={fsStyles.pillChName} numberOfLines={1}>
                  {playingChannel.name}
                </Text>
                {playingChannel.isHD && (
                  <View style={fsStyles.hdBadge}>
                    <Text style={fsStyles.hdText}>HD</Text>
                  </View>
                )}
              </View>

              {/* ── Mini channel row (5 channels, bottom) ──────────────── */}
              <View style={fsStyles.miniRowPanel}>
                <View style={fsStyles.miniRowHeader}>
                  <Icon name="television-play" size={10} color="#22c55e" />
                  <Text style={fsStyles.miniRowLabel}>Switch Channel</Text>
                </View>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={fsStyles.miniRowScroll}
                >
                  {fsChannelRow.map(ch => (
                    <MiniChannelCard
                      key={String(ch.id)}
                      channel={ch}
                      isActive={playingChannel?.id === ch.id}
                      onPress={() => {
                        setCurrentChannel(ch);
                        setPlayingChannel(ch);
                        resetFsControls();
                      }}
                    />
                  ))}
                </ScrollView>
              </View>
            </>
          )}
        </View>
      </Modal>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* ── Top header ──────────────────────────────────────────────────── */}
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

      {/* ── Filter chips ─────────────────────────────────────────────────── */}
      <FilterChips
        selectedLanguage={selectedLanguage}
        selectedGenre={selectedGenre}
        onLanguageChange={setSelectedLanguage}
        onGenreChange={setSelectedGenre}
      />

      {/* ── Channel grid ─────────────────────────────────────────────────── */}
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

      {/* Fullscreen modal accessible from grid too */}
      {renderFullscreenModal()}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingBottom: 10,
    backgroundColor: 'rgba(3,7,18,0.98)',
    borderBottomWidth: 1,
    borderBottomColor: '#0f172a',
    gap: 10,
  },
  backBtn: {
    backgroundColor: 'rgba(30,41,59,0.8)',
    padding: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  headerInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  headerChNum: {
    fontSize: 11,
    fontWeight: '800',
    color: '#3b82f6',
    letterSpacing: 0.8,
  },
  headerChName: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: '#e2e8f0',
  },
  hdBadge: {
    backgroundColor: '#1d4ed8',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: '#3b82f6',
  },
  hdText: { color: '#93c5fd', fontSize: 8, fontWeight: '900', letterSpacing: 0.5 },

  headerActionBtn: {
    backgroundColor: 'rgba(30,41,59,0.8)',
    padding: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },

  playerWrap: {
    width: '100%',
    backgroundColor: '#000',
    position: 'relative',
    overflow: 'hidden',
  },
  liveBadge: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(3,7,18,0.75)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.4)',
    zIndex: 10,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#22c55e' },
  liveText: { fontSize: 9, fontWeight: '900', color: '#22c55e', letterSpacing: 1.2 },

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
  infoName: { fontSize: 14, fontWeight: '800', color: '#e2e8f0' },
  infoMeta: { fontSize: 10, color: '#475569', marginTop: 2, fontWeight: '500' },
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

  // Landscape overlay
  lsOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 5, justifyContent: 'space-between' },
  lsTopBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: isTV ? 20 : 14,
    paddingBottom: 10,
    backgroundColor: 'rgba(3,7,18,0.88)',
    borderBottomWidth: 1,
    borderBottomColor: '#0f172a',
  },
  lsTopLeft:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  lsTopRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  lsAppName:  { fontSize: isTV ? 18 : 14, fontWeight: '900', color: '#f1f5f9' },
  lsMode:     { fontSize: 9, color: '#334155', fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.8 },
  lsChannelBadge: { alignItems: 'flex-end' },
  lsChNum:    { fontSize: isTV ? 14 : 11, fontWeight: '800', color: '#60a5fa', letterSpacing: 1 },
  lsChName:   { fontSize: isTV ? 12 : 10, color: '#475569', maxWidth: 160 },
  lsIconBtn: {
    backgroundColor: 'rgba(30,41,59,0.8)',
    padding: isTV ? 12 : 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  lsBottomPanel: {
    backgroundColor: 'rgba(3,7,18,0.92)',
    borderTopWidth: 1,
    borderTopColor: '#0f172a',
  },

  // Empty state
  emptyState: { alignItems: 'center', paddingVertical: 48, gap: 10 },
  emptyTitle:    { fontSize: 15, color: '#374151', fontWeight: '700' },
  emptySubtitle: { fontSize: 12, color: '#1f2937', textAlign: 'center', paddingHorizontal: 20 },
});

// ─── Fullscreen modal styles ───────────────────────────────────────────────────
const fsStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },

  exitBtn: {
    position: 'absolute',
    top: 14,
    right: 14,
    backgroundColor: 'rgba(0,0,0,0.65)',
    padding: 9,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    zIndex: 20,
  },

  // Top channel info pill
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
  liveDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#22c55e' },
  pillChNum: { fontSize: 11, fontWeight: '800', color: '#60a5fa', letterSpacing: 0.8 },
  pillChName: { fontSize: 12, fontWeight: '700', color: '#e2e8f0', flexShrink: 1 },
  hdBadge: {
    backgroundColor: '#1d4ed8',
    borderRadius: 3,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: '#3b82f6',
  },
  hdText: { color: '#93c5fd', fontSize: 7, fontWeight: '900', letterSpacing: 0.5 },

  // Mini channel row — sits just above the video controls area at the bottom
  miniRowPanel: {
    position: 'absolute',
    bottom: 56,          // sit above the VideoPlayer's own controls bar (~56 dp)
    left: 0,
    right: 0,
    backgroundColor: 'rgba(3,7,18,0.82)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(30,41,59,0.9)',
    paddingTop: 7,
    paddingBottom: 8,
    zIndex: 20,
  },
  miniRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    marginBottom: 6,
  },
  miniRowLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#334155',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  miniRowScroll: {
    paddingHorizontal: 10,
    gap: 0,
  },
});

export default AdvancedUIScreen;