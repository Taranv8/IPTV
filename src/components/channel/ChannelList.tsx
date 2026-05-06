// src/components/channel/ChannelList.tsx
import React, { useRef, useCallback, useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  ScrollView,
  Platform,
  Image,
} from 'react-native';
import { Channel } from '../../types/channel';
import { useChannelContext } from '../../context/ChannelContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {
  fetchEPG,
  getCurrentAndNext,
  formatTime,
  getProgramProgress,
  EPGProgram,
} from '../../services/epgService';
import type { EPGChannel } from '../../services/epgService';

// ─── Constants ────────────────────────────────────────────────────────────────
const isTV = Platform.isTV;

const ITEM_HEIGHT       = isTV ? 80 : 72;
const ITEM_GAP          = 3;
const ITEM_TOTAL        = ITEM_HEIGHT + ITEM_GAP;
const LEFT_PANEL_W      = isTV ? 240 : 180;
const WHEEL_ITEM_HEIGHT = isTV ? 40 : 36;
const WHEEL_VISIBLE_ITEMS = 5;
const WHEEL_PICKER_HEIGHT = WHEEL_ITEM_HEIGHT * WHEEL_VISIBLE_ITEMS;
const WHEEL_SNAP_INTERVAL = WHEEL_ITEM_HEIGHT;

export const LANGUAGES: string[] = [
  'All','Hindi','English','Marathi','Bengali','Telugu',
  'Tamil','Kannada','Gujarati','Odia','Malayalam','Punjabi','Assamese',
];

export const GENRES: string[] = [
  'All','Entertainment','Infotainment','Movies','Sports','News',
  'Business News','Kids','Lifestyle','Educational','Music','Devotional','Comedy',
];

// ─── Safe TV event hook ───────────────────────────────────────────────────────
type TVEventHandlerHook = (cb: (evt: { eventType: string }) => void) => void;
const _useTVEventHandler: TVEventHandlerHook | null = (() => {
  try { return require('react-native').useTVEventHandler ?? null; } catch { return null; }
})();
const _noopHook: TVEventHandlerHook = (_cb) => { useEffect(() => {}, []); };
const useTVEventHandler = _useTVEventHandler ?? _noopHook;

// ─────────────────────────────────────────────────────────────────────────────
// WheelPicker
// ─────────────────────────────────────────────────────────────────────────────
interface WheelPickerProps {
  data: string[];
  selectedValue: string;
  onValueChange: (value: string) => void;
  counts?: Record<string, number>;
  totalCount?: number;
  label: string;
  iconName: string;
  iconColor: string;
}

const WheelPicker: React.FC<WheelPickerProps> = ({
  data, selectedValue, onValueChange,
  counts, totalCount, label, iconName, iconColor,
}) => {
  const flatListRef      = useRef<FlatList>(null);
  const isFocusedRef     = useRef(false);
  const selectedIndexRef = useRef(data.indexOf(selectedValue));

  useEffect(() => {
    selectedIndexRef.current = data.indexOf(selectedValue);
  }, [selectedValue, data]);

  useEffect(() => {
    const idx = data.indexOf(selectedValue);
    if (idx >= 0 && flatListRef.current) {
      const timer = setTimeout(() => {
        flatListRef.current?.scrollToIndex({ index: idx, animated: false, viewPosition: 0.5 });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [selectedValue, data]);

  useTVEventHandler(useCallback((evt: { eventType: string }) => {
    if (!isFocusedRef.current || !flatListRef.current) return;
    if (evt.eventType === 'up') {
      const newIndex = Math.max(0, selectedIndexRef.current - 1);
      if (newIndex !== selectedIndexRef.current) {
        onValueChange(data[newIndex]);
        flatListRef.current?.scrollToIndex({ index: newIndex, animated: true, viewPosition: 0.5 });
      }
    } else if (evt.eventType === 'down') {
      const newIndex = Math.min(data.length - 1, selectedIndexRef.current + 1);
      if (newIndex !== selectedIndexRef.current) {
        onValueChange(data[newIndex]);
        flatListRef.current?.scrollToIndex({ index: newIndex, animated: true, viewPosition: 0.5 });
      }
    }
  }, [data, onValueChange]));

  const handleMomentumScrollEnd = useCallback(
    (e: { nativeEvent: { contentOffset: { y: number } } }) => {
      const offsetY = e.nativeEvent.contentOffset.y;
      const index   = Math.round(offsetY / WHEEL_SNAP_INTERVAL);
      if (index >= 0 && index < data.length) {
        if (data[index] !== selectedValue) onValueChange(data[index]);
        selectedIndexRef.current = index;
      }
    },
    [data, selectedValue, onValueChange],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: string; index: number }) => {
      const isSelected = item === selectedValue;
      const count = counts
        ? (item === 'All' ? totalCount ?? 0 : counts[item] ?? 0)
        : undefined;
      return (
        <Pressable
          style={[wheelStyles.item, isSelected && wheelStyles.itemSelected]}
          onPress={() => {
            if (item !== selectedValue) {
              onValueChange(item);
              flatListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
            }
          }}
          accessible
          accessibilityLabel={`${item}${count !== undefined ? `, ${count} channels` : ''}`}
          accessibilityRole="button"
          accessibilityState={{ selected: isSelected }}
        >
          <View style={wheelStyles.itemContent}>
            <Text style={[wheelStyles.itemText, isSelected && wheelStyles.itemTextSelected]} numberOfLines={1}>
              {item}
            </Text>
            {count !== undefined && (
              <Text style={[wheelStyles.count, isSelected && wheelStyles.countSelected]}>
                {count}
              </Text>
            )}
          </View>
        </Pressable>
      );
    },
    [selectedValue, counts, totalCount, onValueChange],
  );

  const getItemLayout = useCallback(
    (_: any, index: number) => ({ length: WHEEL_ITEM_HEIGHT, offset: WHEEL_ITEM_HEIGHT * index, index }),
    [],
  );

  return (
    <View style={wheelStyles.container}>
      <View style={wheelStyles.header}>
        <Icon name={iconName} size={isTV ? 12 : 10} color={iconColor} />
        <Text style={[wheelStyles.headerText, { color: iconColor }]}>{label}</Text>
      </View>
      <View style={wheelStyles.pickerWrapper}>
        <View style={[wheelStyles.selectedOverlay, { pointerEvents: 'none' }]} />
        <FlatList
          ref={flatListRef}
          data={data}
          renderItem={renderItem}
          keyExtractor={(item) => item}
          getItemLayout={getItemLayout}
          showsVerticalScrollIndicator={false}
          snapToInterval={WHEEL_SNAP_INTERVAL}
          decelerationRate="fast"
          onMomentumScrollEnd={handleMomentumScrollEnd}
          onScrollToIndexFailed={(info) => {
            setTimeout(() => {
              flatListRef.current?.scrollToIndex({
                index: info.index, animated: false, viewPosition: 0.5,
              });
            }, 50);
          }}
          style={wheelStyles.flatList}
          contentContainerStyle={wheelStyles.contentContainer}
          onFocus={() => { isFocusedRef.current = true; }}
          onBlur={() =>  { isFocusedRef.current = false; }}
          focusable={isTV}
          accessible={isTV}
        />
      </View>
    </View>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// LeftPanel
// ─────────────────────────────────────────────────────────────────────────────
interface LeftPanelProps {
  channels: Channel[];
  selectedLanguage: string;
  selectedGenre: string;
  onLanguageChange: (lang: string) => void;
  onGenreChange: (genre: string) => void;
  onActivity?: () => void;
}

const LeftPanel: React.FC<LeftPanelProps> = React.memo(({
  channels, selectedLanguage, selectedGenre,
  onLanguageChange, onGenreChange, onActivity,
}) => {
  const langCounts = useMemo(() => {
    const map: Record<string, number> = {};
    channels.forEach(ch => {
      const lang = ch.language ?? '';
      if (lang) map[lang] = (map[lang] ?? 0) + 1;
    });
    return map;
  }, [channels]);

  const genreCounts = useMemo(() => {
    const map: Record<string, number> = {};
    channels.forEach(ch => {
      const genre = ch.excelGenre || ch.group || '';
      if (genre) map[genre] = (map[genre] ?? 0) + 1;
    });
    return map;
  }, [channels]);

  const handleLanguageChange = useCallback((value: string) => {
    onActivity?.();
    onLanguageChange(value);
  }, [onLanguageChange, onActivity]);

  const handleGenreChange = useCallback((value: string) => {
    onActivity?.();
    onGenreChange(value);
  }, [onGenreChange, onActivity]);

  return (
    <View style={leftPanelStyles.panel}>
      <WheelPicker
        data={LANGUAGES}
        selectedValue={selectedLanguage}
        onValueChange={handleLanguageChange}
        counts={langCounts}
        totalCount={channels.length}
        label="LANGUAGE"
        iconName="translate"
        iconColor="#3b82f6"
      />
      <View style={leftPanelStyles.divider} />
      <WheelPicker
        data={GENRES}
        selectedValue={selectedGenre}
        onValueChange={handleGenreChange}
        counts={genreCounts}
        totalCount={channels.length}
        label="GENRE"
        iconName="filmstrip"
        iconColor="#8b5cf6"
      />
    </View>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// FilterDropdown
// ─────────────────────────────────────────────────────────────────────────────
interface FilterDropdownProps {
  label: string;
  iconName: string;
  iconColor: string;
  data: string[];
  selectedValue: string;
  onSelect: (value: string) => void;
  counts?: Record<string, number>;
  totalCount?: number;
  onOpen?: () => void;
  onClose?: () => void;
}

const FilterDropdown: React.FC<FilterDropdownProps> = React.memo(({
  label, iconName, iconColor, data, selectedValue,
  onSelect, counts, totalCount, onOpen, onClose,
}) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    visible ? onOpen?.() : onClose?.();
  }, [visible, onOpen, onClose]);

  return (
    <View style={dropdownStyles.container}>
      <Pressable
        style={dropdownStyles.button}
        onPress={() => setVisible(true)}
        accessible
        accessibilityLabel={`${label}: ${selectedValue}`}
        accessibilityRole="button"
      >
        <Icon name={iconName} size={14} color={iconColor} />
        <Text style={dropdownStyles.buttonText} numberOfLines={1}>{selectedValue}</Text>
        <Icon name="chevron-down" size={14} color="#64748b" />
      </Pressable>

      {visible && (
        <Pressable style={dropdownStyles.overlay} onPress={() => setVisible(false)}>
          <View style={dropdownStyles.menu}>
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="always"
              style={dropdownStyles.menuScroll}
            >
              {data.map(item => {
                const count = counts
                  ? (item === 'All' ? totalCount ?? 0 : counts[item] ?? 0)
                  : undefined;
                return (
                  <Pressable
                    key={item}
                    style={[dropdownStyles.menuItem, selectedValue === item && dropdownStyles.menuItemActive]}
                    onPress={() => { onSelect(item); setVisible(false); }}
                  >
                    <Text
                      style={[dropdownStyles.menuItemText, selectedValue === item && dropdownStyles.menuItemTextActive]}
                      numberOfLines={1}
                    >
                      {item}
                    </Text>
                    {count !== undefined && (
                      <Text style={dropdownStyles.menuItemCount}>{count}</Text>
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
      )}
    </View>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// FilterDropdowns
// ─────────────────────────────────────────────────────────────────────────────
interface FilterDropdownsProps {
  channels: Channel[];
  selectedLanguage: string;
  selectedGenre: string;
  onLanguageChange: (lang: string) => void;
  onGenreChange: (genre: string) => void;
  onDropdownOpenChange?: (isOpen: boolean) => void;
}

const FilterDropdowns: React.FC<FilterDropdownsProps> = React.memo(({
  channels, selectedLanguage, selectedGenre,
  onLanguageChange, onGenreChange, onDropdownOpenChange,
}) => {
  const langCounts = useMemo(() => {
    const map: Record<string, number> = {};
    channels.forEach(ch => {
      const lang = ch.language ?? '';
      if (lang) map[lang] = (map[lang] ?? 0) + 1;
    });
    return map;
  }, [channels]);

  const genreCounts = useMemo(() => {
    const map: Record<string, number> = {};
    channels.forEach(ch => {
      const genre = ch.excelGenre || ch.group || '';
      if (genre) map[genre] = (map[genre] ?? 0) + 1;
    });
    return map;
  }, [channels]);

  const openCountRef = useRef(0);

  const handleOpen = useCallback(() => {
    openCountRef.current += 1;
    onDropdownOpenChange?.(true);
  }, [onDropdownOpenChange]);

  const handleClose = useCallback(() => {
    openCountRef.current = Math.max(0, openCountRef.current - 1);
    if (openCountRef.current === 0) onDropdownOpenChange?.(false);
  }, [onDropdownOpenChange]);

  return (
    <View style={dropdownsStyles.container}>
      <FilterDropdown
        label="Language" iconName="translate" iconColor="#3b82f6"
        data={LANGUAGES} selectedValue={selectedLanguage} onSelect={onLanguageChange}
        counts={langCounts} totalCount={channels.length}
        onOpen={handleOpen} onClose={handleClose}
      />
      <View style={{ height: 6 }} />
      <FilterDropdown
        label="Genre" iconName="filmstrip" iconColor="#8b5cf6"
        data={GENRES} selectedValue={selectedGenre} onSelect={onGenreChange}
        counts={genreCounts} totalCount={channels.length}
        onOpen={handleOpen} onClose={handleClose}
      />
    </View>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// PortraitFilters
// ─────────────────────────────────────────────────────────────────────────────
interface PortraitFiltersProps {
  selectedLanguage: string;
  selectedGenre: string;
  onLanguageChange: (lang: string) => void;
  onGenreChange: (genre: string) => void;
  onActivity?: () => void;
}

const PortraitFilters: React.FC<PortraitFiltersProps> = React.memo(({
  selectedLanguage, selectedGenre, onLanguageChange, onGenreChange, onActivity,
}) => (
  <View style={portraitFilterStyles.wrapper}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={portraitFilterStyles.row} keyboardShouldPersistTaps="always">
      {LANGUAGES.map(lang => (
        <Pressable
          key={lang}
          style={[portraitFilterStyles.chip, selectedLanguage === lang && portraitFilterStyles.chipActive, selectedLanguage === lang && portraitFilterStyles.chipLangActive]}
          onPress={() => { onActivity?.(); onLanguageChange(lang); }}
        >
          <Text style={[portraitFilterStyles.chipText, selectedLanguage === lang && portraitFilterStyles.chipTextActive]}>
            {lang}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={portraitFilterStyles.row} keyboardShouldPersistTaps="always">
      {GENRES.map(genre => (
        <Pressable
          key={genre}
          style={[portraitFilterStyles.chip, selectedGenre === genre && portraitFilterStyles.chipActive, selectedGenre === genre && portraitFilterStyles.chipGenreActive]}
          onPress={() => { onActivity?.(); onGenreChange(genre); }}
        >
          <Text style={[portraitFilterStyles.chipText, selectedGenre === genre && portraitFilterStyles.chipTextActive]}>
            {genre}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  </View>
));

// ─────────────────────────────────────────────────────────────────────────────
// ProgressBar
// ─────────────────────────────────────────────────────────────────────────────
const ProgressBar: React.FC<{ progress: number; isActive: boolean }> = React.memo(({ progress, isActive }) => (
  <View style={progressStyles.track}>
    <View style={[
      progressStyles.fill,
      { width: `${Math.min(100, Math.max(0, progress))}%` as any },
      isActive && progressStyles.fillActive,
    ]} />
  </View>
));

// ─────────────────────────────────────────────────────────────────────────────
// ChannelRow
// ─────────────────────────────────────────────────────────────────────────────
interface ChannelRowProps {
  channel: Channel;
  index: number;
  isActive: boolean;
  isFocused: boolean;
  isFirst: boolean;
  onPress: () => void;
  onFocusRow: () => void;
  onBlurRow: () => void;
  onActivity?: () => void;
  epgData: Map<string, EPGChannel>;
}

const ChannelRow: React.FC<ChannelRowProps> = React.memo(({
  channel, index, isActive, isFocused, isFirst,
  onPress, onFocusRow, onBlurRow, onActivity, epgData,
}) => {
  const { current, next } = getCurrentAndNext(epgData, String(channel.id ?? channel.number));
  const progress = current ? getProgramProgress(current) : 0;
  const hasLogo  = !!channel.logo;

  return (
    <Pressable
      focusable
      hasTVPreferredFocus={isFirst && isTV}
      style={[rowStyles.row, isActive && rowStyles.rowActive, isFocused && rowStyles.rowFocused]}
      onPress={onPress}
      onFocus={() => { onFocusRow(); onActivity?.(); }}
      onBlur={onBlurRow}
      accessible
      accessibilityLabel={`Channel ${channel.number ?? index + 1}: ${channel.name}`}
      accessibilityRole="button"
      accessibilityState={{ selected: isActive }}
    >
      {isActive && <View style={rowStyles.activeBar} />}

      <View style={rowStyles.logoBlock}>
        <View style={[rowStyles.logoCard, isActive && rowStyles.logoCardActive]}>
          {hasLogo ? (
            <Image source={{ uri: channel.logo }} style={rowStyles.logoImg} resizeMode="contain" />
          ) : (
            <Text style={[rowStyles.logoFallback, isActive && rowStyles.logoFallbackActive]} numberOfLines={2}>
              {channel.name}
            </Text>
          )}
        </View>
        <Text style={[rowStyles.chNum, isActive && rowStyles.chNumActive]}>
          {channel.number ?? index + 1}
        </Text>
      </View>

      <View style={rowStyles.mainInfo}>
        <View style={rowStyles.nameRow}>
          <Text style={[rowStyles.channelName, isActive && rowStyles.channelNameActive]} numberOfLines={1}>
            {channel.name}
          </Text>
          <View style={rowStyles.badges}>
            {channel.isHD && (
              <View style={[rowStyles.hdBadge, isActive && rowStyles.hdBadgeActive]}>
                <Text style={rowStyles.hdText}>HD</Text>
              </View>
            )}
            {channel.isFavorite && (
              <Icon name="star" size={11} color={isActive ? '#fbbf24' : '#78350f'} />
            )}
          </View>
        </View>

        {current ? (
          <>
            <View style={rowStyles.programRow}>
              <View style={[rowStyles.liveIndicator, isActive && rowStyles.liveIndicatorActive]} />
              <Text style={[rowStyles.programTitle, isActive && rowStyles.programTitleActive]} numberOfLines={1}>
                {current.title}
              </Text>
            </View>
            <View style={rowStyles.progressRow}>
              <Text style={[rowStyles.timeText, isActive && rowStyles.timeTextActive]}>
                {formatTime(current.startTime)}
              </Text>
              <ProgressBar progress={progress} isActive={isActive} />
              <Text style={[rowStyles.timeText, isActive && rowStyles.timeTextActive]}>
                {formatTime(current.endTime)}
              </Text>
            </View>
          </>
        ) : (
          <Text style={rowStyles.noInfo}>No program information</Text>
        )}
      </View>

      {next && (
        <View style={rowStyles.nextBlock}>
          <Text style={rowStyles.nextLabel}>NEXT</Text>
          <Text style={[rowStyles.nextTitle, isActive && rowStyles.nextTitleActive]} numberOfLines={2}>
            {next.title}
          </Text>
          <Text style={[rowStyles.nextTime, isActive && rowStyles.nextTimeActive]}>
            {formatTime(next.startTime)}
          </Text>
        </View>
      )}
    </Pressable>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// PortraitChannelRow
// ─────────────────────────────────────────────────────────────────────────────
interface PortraitRowProps {
  channel: Channel;
  index: number;
  isActive: boolean;
  onPress: () => void;
  epgData: Map<string, EPGChannel>;
}

const PortraitChannelRow: React.FC<PortraitRowProps> = React.memo(({
  channel, index, isActive, onPress, epgData,
}) => {
  const { current } = getCurrentAndNext(epgData, String(channel.id ?? channel.number));
  const progress = current ? getProgramProgress(current) : 0;
  const hasLogo  = !!channel.logo;

  return (
    <Pressable
      style={[portraitRowStyles.row, isActive && portraitRowStyles.rowActive]}
      onPress={onPress}
      accessible
      accessibilityLabel={`Channel ${channel.number ?? index + 1}: ${channel.name}`}
      accessibilityRole="button"
      accessibilityState={{ selected: isActive }}
    >
      {isActive && <View style={portraitRowStyles.activeBar} />}

      <View style={[portraitRowStyles.logoCard, isActive && portraitRowStyles.logoCardActive]}>
        {hasLogo ? (
          <Image source={{ uri: channel.logo }} style={portraitRowStyles.logoImg} resizeMode="contain" />
        ) : (
          <Text style={[portraitRowStyles.logoFallback, isActive && portraitRowStyles.logoFallbackActive]} numberOfLines={2}>
            {channel.name}
          </Text>
        )}
      </View>

      <View style={portraitRowStyles.info}>
        <View style={portraitRowStyles.topRow}>
          <Text style={[portraitRowStyles.name, isActive && portraitRowStyles.nameActive]} numberOfLines={1}>
            {channel.name}
          </Text>
          {channel.isHD && (
            <View style={[portraitRowStyles.hdBadge, isActive && portraitRowStyles.hdBadgeActive]}>
              <Text style={portraitRowStyles.hdText}>HD</Text>
            </View>
          )}
          {channel.isFavorite && (
            <Icon name="star" size={10} color={isActive ? '#fbbf24' : '#78350f'} />
          )}
        </View>

        {current ? (
          <>
            <Text style={[portraitRowStyles.program, isActive && portraitRowStyles.programActive]} numberOfLines={1}>
              {current.title}
            </Text>
            <View style={portraitRowStyles.progressRow}>
              <View style={portraitRowStyles.progressTrack}>
                <View style={[
                  portraitRowStyles.progressFill,
                  { width: `${progress}%` as any },
                  isActive && portraitRowStyles.progressFillActive,
                ]} />
              </View>
              <Text style={[portraitRowStyles.timeText, isActive && portraitRowStyles.timeTextActive]}>
                {formatTime(current.endTime)}
              </Text>
            </View>
          </>
        ) : (
          <Text style={portraitRowStyles.noInfo}>No info</Text>
        )}
      </View>

      <Text style={[portraitRowStyles.chNum, isActive && portraitRowStyles.chNumActive]}>
        {channel.number ?? index + 1}
      </Text>
    </Pressable>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// ChannelListHeader
// ─────────────────────────────────────────────────────────────────────────────
const ChannelListHeader: React.FC<{
  count: number;
  epgLoading: boolean;
  selectedLanguage: string;
  selectedGenre: string;
}> = React.memo(({ count, epgLoading, selectedLanguage, selectedGenre }) => (
  <View style={listHeaderStyles.container}>
    <View style={listHeaderStyles.left}>
      <Icon name="television-play" size={13} color="#3b82f6" />
      <Text style={listHeaderStyles.label}>{count} Channel{count !== 1 ? 's' : ''}</Text>
      {selectedLanguage !== 'All' && (
        <View style={listHeaderStyles.filterTag}>
          <Icon name="translate" size={10} color="#60a5fa" />
          <Text style={listHeaderStyles.filterTagText}>{selectedLanguage}</Text>
        </View>
      )}
      {selectedGenre !== 'All' && (
        <View style={[listHeaderStyles.filterTag, listHeaderStyles.filterTagGenre]}>
          <Icon name="filmstrip" size={10} color="#a78bfa" />
          <Text style={[listHeaderStyles.filterTagText, listHeaderStyles.filterTagTextGenre]}>{selectedGenre}</Text>
        </View>
      )}
    </View>
    <View style={listHeaderStyles.right}>
      <Icon name="clock-outline" size={12} color="#374151" />
      <Text style={listHeaderStyles.epgLabel}>Now Playing</Text>
      <Icon name="arrow-right" size={11} color="#1e293b" />
      <Text style={listHeaderStyles.nextLabel}>Up Next</Text>
      {epgLoading && <Text style={listHeaderStyles.updating}>Updating…</Text>}
    </View>
  </View>
));

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────
interface Props {
  channels: Channel[];
  currentChannel: Channel | null;
  onChannelSelect: (channelNumber: number) => void;
  onActivity?: () => void;
  showEPG?: boolean;
  isLandscape?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// ChannelList
// ─────────────────────────────────────────────────────────────────────────────
const ChannelList: React.FC<Props> = ({
  channels, currentChannel, onChannelSelect, onActivity,
  showEPG = true, isLandscape = false,
}) => {
  const flatListRef = useRef<FlatList>(null);

  const [selectedLanguage, setSelectedLanguage] = useState('All');
  const [selectedGenre,    setSelectedGenre]    = useState('All');
  const [isDropdownOpen,   setIsDropdownOpen]   = useState(false);
  const [epgData,          setEpgData]          = useState<Map<string, EPGChannel>>(new Map());
  const [epgLoading,       setEpgLoading]       = useState(false);

  const focusedIndexRef = useRef<number | null>(null);
  const [, forceUpdate] = useState(0);

  const channelsRef = useRef(channels);
  useEffect(() => { channelsRef.current = channels; }, [channels]);

  // ── EPG initial fetch ──────────────────────────────────────────────────────
  useEffect(() => {
    if (channels.length === 0) return;
    let cancelled = false;
    setEpgLoading(true);
    const ids = channels.map(ch => String(ch.id ?? ch.number));
    fetchEPG(ids).then((data: Map<string, EPGChannel>) => {
      if (!cancelled) { setEpgData(data); setEpgLoading(false); }
    });
    return () => { cancelled = true; };
  }, [channels]);

  // ── EPG refresh interval ───────────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      const current = channelsRef.current;
      if (current.length === 0) return;
      const ids = current.map(ch => String(ch.id ?? ch.number));
      fetchEPG(ids).then(data => setEpgData(data));
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // ── Filtered channels ──────────────────────────────────────────────────────
  const displayChannels = useMemo(() =>
    channels.filter(ch => {
      const chLang  = ch.language ?? '';
      const chGenre = ch.excelGenre || ch.group || '';
      return (
        (selectedLanguage === 'All' || chLang === selectedLanguage) &&
        (selectedGenre    === 'All' || chGenre === selectedGenre)
      );
    }),
    [channels, selectedLanguage, selectedGenre],
  );

  const showLeftPanel = isTV || isLandscape;

  // ── Scroll to current channel once ─────────────────────────────────────────
  const hasScrolledRef = useRef(false);
  useEffect(() => { hasScrolledRef.current = false; }, [displayChannels.length]);

  const handleLayout = useCallback(() => {
    if (hasScrolledRef.current || !currentChannel || displayChannels.length === 0) return;
    const idx = displayChannels.findIndex(ch => ch.id === currentChannel.id);
    if (idx > 0) {
      flatListRef.current?.scrollToIndex({ index: idx, animated: false, viewPosition: 0.3 });
      hasScrolledRef.current = true;
    }
  }, [displayChannels, currentChannel]);

  // ── Filter handlers ────────────────────────────────────────────────────────
  const handleLanguageChange = useCallback((lang: string) => {
    setSelectedLanguage(lang);
    focusedIndexRef.current = null;
  }, []);

  const handleGenreChange = useCallback((genre: string) => {
    setSelectedGenre(genre);
    focusedIndexRef.current = null;
  }, []);

  // ── Channel press ──────────────────────────────────────────────────────────
  const handleChannelPress = useCallback((channel: Channel, index: number) => {
    onActivity?.();
    onChannelSelect(channel.number ?? index + 1);
  }, [onChannelSelect, onActivity]);

  // ── FlatList helpers ───────────────────────────────────────────────────────
  const handleScrollToIndexFailed = useCallback(
    (info: { index: number; highestMeasuredFrameIndex: number }) => {
      setTimeout(() => {
        flatListRef.current?.scrollToIndex({
          index: Math.min(info.index, info.highestMeasuredFrameIndex),
          animated: false, viewPosition: 0.3,
        });
      }, 100);
    }, [],
  );

  const getItemLayout = useCallback(
    (_: any, index: number) => ({
      length: showLeftPanel ? ITEM_HEIGHT : 62,
      offset: (showLeftPanel ? ITEM_TOTAL : 65) * index,
      index,
    }),
    [showLeftPanel],
  );

  const keyExtractor = useCallback(
    (item: Channel, index: number) => String(item.id ?? `ch-${index}`),
    [],
  );

  // ── renderItem ─────────────────────────────────────────────────────────────
  const renderItem = useCallback(
    ({ item, index }: { item: Channel; index: number }) =>
      showLeftPanel ? (
        <ChannelRow
          channel={item}
          index={index}
          isActive={currentChannel?.id === item.id}
          isFocused={focusedIndexRef.current === index}
          isFirst={index === 0}
          onPress={() => handleChannelPress(item, index)}
          onFocusRow={() => {
            focusedIndexRef.current = index;
            forceUpdate(n => n + 1);
          }}
          onBlurRow={() => {
            if (focusedIndexRef.current === index) {
              focusedIndexRef.current = null;
              forceUpdate(n => n + 1);
            }
          }}
          onActivity={onActivity}
          epgData={epgData}
        />
      ) : (
        <PortraitChannelRow
          channel={item}
          index={index}
          isActive={currentChannel?.id === item.id}
          onPress={() => handleChannelPress(item, index)}
          epgData={epgData}
        />
      ),
    [currentChannel, handleChannelPress, onActivity, epgData, showLeftPanel],
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <View style={[mainStyles.root, isDropdownOpen && { overflow: 'visible' }]}>
      {isTV && (
        <LeftPanel
          channels={channels}
          selectedLanguage={selectedLanguage}
          selectedGenre={selectedGenre}
          onLanguageChange={handleLanguageChange}
          onGenreChange={handleGenreChange}
          onActivity={onActivity}
        />
      )}
      {!isTV && isLandscape && (
        <FilterDropdowns
          channels={channels}
          selectedLanguage={selectedLanguage}
          selectedGenre={selectedGenre}
          onLanguageChange={handleLanguageChange}
          onGenreChange={handleGenreChange}
          onDropdownOpenChange={setIsDropdownOpen}
        />
      )}
      <View style={mainStyles.listArea}>
        {!showLeftPanel && (
          <PortraitFilters
            selectedLanguage={selectedLanguage}
            selectedGenre={selectedGenre}
            onLanguageChange={handleLanguageChange}
            onGenreChange={handleGenreChange}
            onActivity={onActivity}
          />
        )}
        {showLeftPanel && (
          <ChannelListHeader
            count={displayChannels.length}
            epgLoading={epgLoading}
            selectedLanguage={selectedLanguage}
            selectedGenre={selectedGenre}
          />
        )}
        <FlatList
          ref={flatListRef}
          data={displayChannels}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          style={mainStyles.list}
          contentContainerStyle={mainStyles.listContent}
          showsVerticalScrollIndicator={false}
          getItemLayout={getItemLayout}
          onScrollToIndexFailed={handleScrollToIndexFailed}
          onLayout={handleLayout}
          onScroll={() => onActivity?.()}
          scrollEventThrottle={200}
          onMomentumScrollBegin={() => onActivity?.()}
          removeClippedSubviews={isTV}
          disableIntervalMomentum
          windowSize={isTV ? 21 : 9}
          maxToRenderPerBatch={isTV ? 30 : 14}
          initialNumToRender={isTV ? 30 : 16}
          keyboardShouldPersistTaps="always"
          ListEmptyComponent={
            <View style={mainStyles.emptyState}>
              <Icon name="television-off" size={42} color="#1e293b" />
              <Text style={mainStyles.emptyTitle}>No channels found</Text>
              <Text style={mainStyles.emptySubtitle}>
                {selectedLanguage !== 'All' || selectedGenre !== 'All'
                  ? 'Try changing Language or Genre filter'
                  : 'Add channels to your playlist'}
              </Text>
            </View>
          }
        />
        <View style={mainStyles.footer}>
          <View style={mainStyles.legend}>
            <View style={mainStyles.legendItem}>
              <View style={[mainStyles.legendDot, { backgroundColor: '#ef4444' }]} />
              <Text style={mainStyles.legendText}>Live</Text>
            </View>
            <View style={mainStyles.legendItem}>
              <Icon name="star" size={9} color="#fbbf24" />
              <Text style={mainStyles.legendText}>Favourite</Text>
            </View>
            <View style={mainStyles.legendItem}>
              <View style={[mainStyles.legendDot, { backgroundColor: '#3b82f6' }]} />
              <Text style={mainStyles.legendText}>HD</Text>
            </View>
          </View>
          <Text style={mainStyles.footerCount}>
            {displayChannels.length} of {channels.length} ch
          </Text>
        </View>
      </View>
    </View>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Stylesheets (from unoptimized version)
// ─────────────────────────────────────────────────────────────────────────────

const wheelStyles = StyleSheet.create({
  container: {
    flex: 1,
    marginHorizontal: 4,
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: isTV ? 8 : 6,
    backgroundColor: 'rgba(15,23,42,0.98)',
    borderBottomWidth: 1,
    borderBottomColor: '#0f172a',
  },
  headerText: {
    fontSize: isTV ? 10 : 9,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  pickerWrapper: {
    height: WHEEL_PICKER_HEIGHT,
    justifyContent: 'center',
    backgroundColor: 'rgba(5,10,25,0.95)',
  },
  selectedOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(59,130,246,0.35)',
    backgroundColor: 'rgba(29,78,216,0.15)',
    top: (WHEEL_PICKER_HEIGHT - WHEEL_ITEM_HEIGHT) / 2,
    height: WHEEL_ITEM_HEIGHT,
    zIndex: 0,
  },
  flatList: {
    flex: 1,
    zIndex: 1,
  },
  contentContainer: {
    paddingVertical: (WHEEL_PICKER_HEIGHT - WHEEL_ITEM_HEIGHT) / 2,
  },
  item: {
    height: WHEEL_ITEM_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
    borderRadius: 6,
    marginHorizontal: 4,
  },
  itemSelected: {
    backgroundColor: 'rgba(29,78,216,0.35)',
  },
  itemContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  itemText: {
    fontSize: isTV ? 12 : 11,
    color: '#64748b',
    fontWeight: '500',
  },
  itemTextSelected: {
    color: '#f1f5f9',
    fontWeight: '700',
  },
  count: {
    fontSize: 10,
    color: '#374151',
    backgroundColor: 'rgba(30,41,59,0.7)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 6,
    overflow: 'hidden',
  },
  countSelected: {
    color: '#93c5fd',
    backgroundColor: 'rgba(30,64,175,0.6)',
  },
});

const leftPanelStyles = StyleSheet.create({
  panel: {
    width: LEFT_PANEL_W,
    backgroundColor: 'rgba(5,10,25,0.98)',
    borderRightWidth: 1,
    borderRightColor: '#0f172a',
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  divider: {
    width: 1,
    backgroundColor: '#1e293b',
    marginVertical: 0,
  },
});

const dropdownStyles = StyleSheet.create({
  container: {
    flex: 1,
    marginHorizontal: 4,
    justifyContent: 'center',
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(30,41,59,0.8)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 6,
  },
  buttonText: {
    flex: 1,
    fontSize: 12,
    color: '#f1f5f9',
    fontWeight: '600',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
    zIndex: 100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  menu: {
    width: 180,
    maxHeight: 280,
    backgroundColor: '#0f172a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
    overflow: 'hidden',
    elevation: 10,
  },
  menuScroll: {
    paddingVertical: 6,
  },
  menuItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 6,
    marginHorizontal: 4,
    marginVertical: 2,
  },
  menuItemActive: {
    backgroundColor: '#1e3a5f',
  },
  menuItemText: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '500',
  },
  menuItemTextActive: {
    color: '#f1f5f9',
    fontWeight: '700',
  },
  menuItemCount: {
    fontSize: 10,
    color: '#64748b',
    backgroundColor: '#1e293b',
    paddingHorizontal: 5,
    borderRadius: 8,
    overflow: 'hidden',
  },
});

const dropdownsStyles = StyleSheet.create({
  container: {
    flexDirection: 'column',
    width: LEFT_PANEL_W,
    backgroundColor: 'rgba(5,10,25,0.98)',
    borderRightWidth: 1,
    borderRightColor: '#0f172a',
    paddingVertical: 10,
    paddingHorizontal: 6,
  },
});

const portraitFilterStyles = StyleSheet.create({
  wrapper: {
    backgroundColor: 'rgba(5,10,25,0.98)',
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
    paddingVertical: 4,
  },
  row: {
    flexGrow: 0,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  chip: {
    paddingHorizontal: 11,
    paddingVertical: 5,
    backgroundColor: 'rgba(30,41,59,0.7)',
    borderRadius: 20,
    marginRight: 6,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  chipActive: {
    borderWidth: 1,
  },
  chipLangActive: {
    backgroundColor: 'rgba(29,78,216,0.3)',
    borderColor: '#3b82f6',
  },
  chipGenreActive: {
    backgroundColor: 'rgba(109,40,217,0.3)',
    borderColor: '#8b5cf6',
  },
  chipText: {
    color: '#475569',
    fontSize: 11,
    fontWeight: '500',
  },
  chipTextActive: {
    color: '#fff',
    fontWeight: '700',
  },
});

const progressStyles = StyleSheet.create({
  track: {
    flex: 1,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    backgroundColor: '#1d4ed8',
    borderRadius: 2,
  },
  fillActive: { backgroundColor: '#3b82f6' },
});

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: ITEM_HEIGHT,
    marginBottom: ITEM_GAP,
    borderRadius: 8,
    backgroundColor: 'rgba(10,15,30,0.7)',
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.8)',
    overflow: 'hidden',
    position: 'relative',
  },
  rowActive: {
    backgroundColor: 'rgba(29,78,216,0.18)',
    borderColor: '#1d4ed8',
    borderWidth: 1.5,
  },
  rowFocused: {
    backgroundColor: 'rgba(99,102,241,0.18)',
    borderColor: '#6366f1',
    borderWidth: 2,
    transform: [{ scale: 1.01 }],
  },
  activeBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: '#3b82f6',
    zIndex: 2,
  },
  logoBlock: {
    width: isTV ? 88 : 72,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    gap: 4,
  },
  logoCard: {
    width: isTV ? 64 : 52,
    height: isTV ? 40 : 34,
    borderRadius: 6,
    backgroundColor: 'rgba(15,23,42,0.9)',
    borderWidth: 1,
    borderColor: '#1e293b',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logoCardActive: {
    borderColor: '#1d4ed8',
    backgroundColor: 'rgba(15,23,42,1)',
  },
  logoImg: {
    width: '90%',
    height: '90%',
  },
  logoFallback: {
    fontSize: isTV ? 9 : 8,
    color: '#475569',
    fontWeight: '700',
    textAlign: 'center',
    paddingHorizontal: 3,
  },
  logoFallbackActive: { color: '#93c5fd' },
  chNum: {
    fontSize: isTV ? 11 : 10,
    color: '#1e3a5f',
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  chNumActive: { color: '#3b82f6' },
  mainInfo: {
    flex: 1,
    paddingVertical: 8,
    paddingRight: 6,
    justifyContent: 'center',
    gap: 3,
    borderLeftWidth: 1,
    borderLeftColor: '#0f172a',
    paddingLeft: 10,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  channelName: {
    flex: 1,
    fontSize: isTV ? 15 : 13,
    fontWeight: '700',
    color: '#94a3b8',
    letterSpacing: 0.1,
  },
  channelNameActive: { color: '#f1f5f9' },
  badges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  hdBadge: {
    backgroundColor: 'rgba(30,64,175,0.5)',
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: '#1e3a8a',
  },
  hdBadgeActive: { backgroundColor: '#1d4ed8', borderColor: '#3b82f6' },
  hdText: {
    color: '#93c5fd',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  programRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  liveIndicator: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#dc2626',
    flexShrink: 0,
  },
  liveIndicatorActive: { backgroundColor: '#ef4444' },
  programTitle: {
    flex: 1,
    fontSize: isTV ? 12 : 11,
    color: '#475569',
    fontWeight: '500',
  },
  programTitleActive: { color: '#cbd5e1' },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  timeText: {
    fontSize: 9,
    color: '#1e3a5f',
    fontWeight: '600',
    flexShrink: 0,
  },
  timeTextActive: { color: '#3b82f6' },
  noInfo: {
    fontSize: 11,
    color: '#1e293b',
    fontStyle: 'italic',
  },
  nextBlock: {
    width: isTV ? 120 : 98,
    paddingHorizontal: 8,
    paddingVertical: 6,
    alignItems: 'flex-start',
    borderLeftWidth: 1,
    borderLeftColor: '#0f172a',
    justifyContent: 'center',
    gap: 2,
  },
  nextLabel: {
    fontSize: 8,
    color: '#1e3a5f',
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  nextTitle: {
    fontSize: isTV ? 11 : 10,
    color: '#334155',
    fontWeight: '500',
    lineHeight: 14,
  },
  nextTitleActive: { color: '#64748b' },
  nextTime: {
    fontSize: 9,
    color: '#1e3a5f',
    fontWeight: '600',
  },
  nextTimeActive: { color: '#3b82f6' },
});

const portraitRowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 62,
    marginBottom: 3,
    borderRadius: 8,
    backgroundColor: 'rgba(10,15,30,0.7)',
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.8)',
    overflow: 'hidden',
    position: 'relative',
    paddingRight: 10,
  },
  rowActive: {
    backgroundColor: 'rgba(29,78,216,0.18)',
    borderColor: '#1d4ed8',
    borderWidth: 1.5,
  },
  activeBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: '#3b82f6',
    zIndex: 2,
  },
  logoCard: {
    width: 52,
    height: 38,
    marginLeft: 8,
    marginRight: 10,
    borderRadius: 6,
    backgroundColor: 'rgba(15,23,42,0.9)',
    borderWidth: 1,
    borderColor: '#1e293b',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexShrink: 0,
  },
  logoCardActive: { borderColor: '#1d4ed8' },
  logoImg: { width: '90%', height: '90%' },
  logoFallback: { fontSize: 9, color: '#475569', fontWeight: '700', textAlign: 'center', paddingHorizontal: 2 },
  logoFallbackActive: { color: '#93c5fd' },
  info: { flex: 1, gap: 3 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  name: { flex: 1, fontSize: 13, fontWeight: '700', color: '#94a3b8' },
  nameActive: { color: '#f1f5f9' },
  hdBadge: {
    backgroundColor: 'rgba(30,64,175,0.5)',
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: '#1e3a8a',
  },
  hdBadgeActive: { backgroundColor: '#1d4ed8', borderColor: '#3b82f6' },
  hdText: { color: '#93c5fd', fontSize: 7, fontWeight: '900', letterSpacing: 0.5 },
  program: { fontSize: 11, color: '#374151', fontWeight: '500' },
  programActive: { color: '#93c5fd' },
  noInfo: { fontSize: 10, color: '#1e293b', fontStyle: 'italic' },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  progressTrack: {
    flex: 1,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 1,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#1d4ed8',
    borderRadius: 1,
  },
  progressFillActive: { backgroundColor: '#3b82f6' },
  timeText: { fontSize: 9, color: '#1e3a5f', fontWeight: '600' },
  timeTextActive: { color: '#60a5fa' },
  chNum: {
    fontSize: 10,
    color: '#1e3a5f',
    fontWeight: '800',
    marginLeft: 6,
    flexShrink: 0,
  },
  chNumActive: { color: '#3b82f6' },
});

const listHeaderStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: 'rgba(5,10,25,0.98)',
    borderBottomWidth: 1,
    borderBottomColor: '#0f172a',
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  label: { fontSize: 11, color: '#334155', fontWeight: '700' },
  filterTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(29,78,216,0.2)',
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: '#1d4ed8',
  },
  filterTagGenre: {
    backgroundColor: 'rgba(109,40,217,0.2)',
    borderColor: '#7c3aed',
  },
  filterTagText: { fontSize: 10, color: '#60a5fa', fontWeight: '600' },
  filterTagTextGenre: { color: '#a78bfa' },
  right: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  epgLabel: { fontSize: 10, color: '#374151', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  nextLabel: { fontSize: 10, color: '#1e293b', fontWeight: '500' },
  updating: { fontSize: 10, color: '#3b82f6', marginLeft: 4 },
});

const mainStyles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: 'rgba(3,7,18,0.92)',
    borderRadius: isTV ? 16 : 12,
    borderWidth: 1,
    borderColor: '#0f172a',
    overflow: 'hidden',
  },
  listArea: {
    flex: 1,
    flexDirection: 'column',
  },
  list: { flex: 1 },
  listContent: {
    paddingVertical: 5,
    paddingHorizontal: 5,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 10,
  },
  emptyTitle: { fontSize: 15, color: '#374151', fontWeight: '700' },
  emptySubtitle: { fontSize: 12, color: '#1f2937', textAlign: 'center', paddingHorizontal: 20 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: 'rgba(3,7,18,0.98)',
    borderTopWidth: 1,
    borderTopColor: '#0f172a',
  },
  legend: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 6, height: 6, borderRadius: 3 },
  legendText: { color: '#374151', fontSize: 10 },
  footerCount: { color: '#1e293b', fontSize: 11, fontWeight: '600' },
});

export default ChannelList;