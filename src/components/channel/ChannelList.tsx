import React, { useRef, useCallback, useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  ScrollView,
  Platform,
  Image,
  LayoutChangeEvent,
} from 'react-native';
import { Channel } from '../../types/channel';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

// ─── Constants ────────────────────────────────────────────────────────────────
const isTV = Platform.isTV;

const ITEM_HEIGHT         = isTV ? 80 : 72;
const ITEM_GAP            = 3;
const ITEM_TOTAL          = ITEM_HEIGHT + ITEM_GAP;

// ── Increased panel width and divider gap ──────────────────────────────────
const LEFT_PANEL_W        = isTV ? 420 : 320;   // was 300 / 230
const WHEEL_DIVIDER_W     = isTV ? 20 : 16;     // was 8 (the gap between the two wheels)

const WHEEL_ITEM_HEIGHT   = isTV ? 40 : 36;
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
// WheelPickerItem — isolated component so each item tracks its own focus state
// ─────────────────────────────────────────────────────────────────────────────
interface WheelPickerItemProps {
  item: string;
  index: number;
  isSelected: boolean;
  count?: number;
  onValueChange: (value: string) => void;
flatListRef: React.RefObject<FlatList | null>;
  onItemFocus: () => void;
  onItemBlur: () => void;
}

const WheelPickerItem: React.FC<WheelPickerItemProps> = React.memo(({
  item, index, isSelected, count,
  onValueChange, flatListRef, onItemFocus, onItemBlur,
}) => {
  const [isFocused, setIsFocused] = useState(false);

  const handleFocus = useCallback(() => {
    setIsFocused(true);
    onItemFocus();
  }, [onItemFocus]);

  const handleBlur = useCallback(() => {
    setIsFocused(false);
    onItemBlur();
  }, [onItemBlur]);

  const handlePress = useCallback(() => {
    onValueChange(item);
    flatListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.3 });
  }, [item, index, onValueChange, flatListRef]);

  return (
    <Pressable
      focusable
      style={[
        wheelStyles.item,
        isSelected  && wheelStyles.itemSelected,
        isFocused   && !isSelected && wheelStyles.itemFocused,
        isFocused   && isSelected  && wheelStyles.itemFocusedSelected,
      ]}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onPress={handlePress}
      accessible
      accessibilityLabel={`${item}${count !== undefined ? `, ${count} channels` : ''}`}
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
    >
      {/* Focused accent bar on the left (visible when focused but NOT selected) */}
      {isFocused && !isSelected && <View style={wheelStyles.focusBar} />}

      <Text
        style={[
          wheelStyles.itemText,
          isSelected && wheelStyles.itemTextSelected,
          isFocused  && !isSelected && wheelStyles.itemTextFocused,
          isFocused  && isSelected  && wheelStyles.itemTextFocusedSelected,
        ]}
        numberOfLines={1}
      >
        {item}
      </Text>
      {count !== undefined && (
        <Text
          style={[
            wheelStyles.count,
            isSelected && wheelStyles.countSelected,
            isFocused  && !isSelected && wheelStyles.countFocused,
          ]}
        >
          {count}
        </Text>
      )}
    </Pressable>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// WheelPicker (full height + smooth D‑pad)
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
  const flatListRef  = useRef<FlatList>(null);
  const [isFocused, setIsFocused] = useState(false);

  // Scroll to selected item whenever selectedValue changes
  useEffect(() => {
    const idx = data.indexOf(selectedValue);
    if (idx >= 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.3 });
      }, 100);
    }
  }, [selectedValue, data]);

  const getItemLayout = useCallback(
    (_: any, index: number) => ({ length: WHEEL_ITEM_HEIGHT, offset: WHEEL_ITEM_HEIGHT * index, index }),
    [],
  );

  const handleItemFocus  = useCallback(() => setIsFocused(true),  []);
  const handleItemBlur   = useCallback(() => setIsFocused(false), []);

  const renderItem = useCallback(
    ({ item, index }: { item: string; index: number }) => {
      const isSelected = item === selectedValue;
      const count = counts
        ? (item === 'All' ? totalCount ?? 0 : counts[item] ?? 0)
        : undefined;

      return (
        <WheelPickerItem
          item={item}
          index={index}
          isSelected={isSelected}
          count={count}
          onValueChange={onValueChange}
          flatListRef={flatListRef}
          onItemFocus={handleItemFocus}
          onItemBlur={handleItemBlur}
        />
      );
    },
    [selectedValue, counts, totalCount, onValueChange, handleItemFocus, handleItemBlur],
  );

  return (
    <View style={[wheelStyles.container, isFocused && wheelStyles.containerFocused]}>
      <View style={[wheelStyles.header, isFocused && wheelStyles.headerFocused]}>
        <Icon name={iconName} size={isTV ? 12 : 10} color={isFocused ? '#fff' : iconColor} />
        <Text style={[wheelStyles.headerText, { color: isFocused ? '#fff' : iconColor }]}>
          {label}
        </Text>
      </View>
      <FlatList
        ref={flatListRef}
        data={data}
        renderItem={renderItem}
        keyExtractor={(item) => item}
        getItemLayout={getItemLayout}
        showsVerticalScrollIndicator={false}
        onScrollToIndexFailed={(info) => {
          setTimeout(() => {
            flatListRef.current?.scrollToIndex({
              index: info.index, animated: false, viewPosition: 0.3,
            });
          }, 50);
        }}
        style={wheelStyles.flatList}
        contentContainerStyle={wheelStyles.contentContainer}
        windowSize={9}
        maxToRenderPerBatch={14}
        initialNumToRender={13}
      />
    </View>
  );
};

const wheelStyles = StyleSheet.create({
  container: {
    flex: 1,
    marginHorizontal: 10,
    flexDirection: 'column',
    overflow: 'hidden',
  },
  containerFocused: {
    borderWidth: 1,
    borderColor: '#3b82f6',
    borderRadius: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 4,
    paddingHorizontal: 6,
    paddingVertical: isTV ? 8 : 6,
    backgroundColor: 'rgba(15,23,42,0.98)',
    borderBottomWidth: 1,
    borderBottomColor: '#0f172a',
  },
  headerFocused: {
    backgroundColor: 'rgba(29,78,216,0.5)',
  },
  headerText: {
    fontSize: isTV ? 10 : 9,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  flatList: {
    flex: 1,
  },
  contentContainer: {
    paddingVertical: 4,
  },

  // ── Item base ──────────────────────────────────────────────────────────────
  item: {
    height: WHEEL_ITEM_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: 8,
    borderRadius: 6,
    marginHorizontal: 4,
    marginVertical: 1,
    position: 'relative',         // needed so focusBar can be absolute
    overflow: 'hidden',
  },

  // ── Selected (not focused) — blue left bar, blue-tinted bg ────────────────
  itemSelected: {
    backgroundColor: 'rgba(29,78,216,0.35)',
    borderLeftWidth: 2,
    borderLeftColor: '#3b82f6',
  },

  // ── Focused (not selected) — violet tint + lighter bar ────────────────────
  itemFocused: {
    backgroundColor: 'rgba(99,102,241,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(129,140,248,0.55)',
    borderRadius: 6,
  },

  // ── Focused AND selected — merge both states ───────────────────────────────
  itemFocusedSelected: {
    backgroundColor: 'rgba(29,78,216,0.50)',
    borderWidth: 1.5,
    borderColor: '#60a5fa',
    borderRadius: 6,
  },

  // Thin left accent bar shown only when focused-but-not-selected
  focusBar: {
    position: 'absolute',
    left: 0,
    top: 4,
    bottom: 4,
    width: 2,
    backgroundColor: '#818cf8',
    borderRadius: 2,
  },

  // ── Text variants ──────────────────────────────────────────────────────────
  itemText: {
    fontSize: isTV ? 12 : 11,
    color: '#64748b',
    fontWeight: '500',
  },
  itemTextSelected: {
    color: '#f1f5f9',
    fontWeight: '700',
  },
  itemTextFocused: {
    color: '#c7d2fe',          // soft indigo — distinct from selected white
    fontWeight: '600',
  },
  itemTextFocusedSelected: {
    color: '#ffffff',
    fontWeight: '800',
  },

  // ── Count badge variants ───────────────────────────────────────────────────
  count: {
    fontSize: 9,
    color: '#374151',
    backgroundColor: 'rgba(30,41,59,0.7)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 6,
    overflow: 'hidden',
    marginTop: 2,
  },
  countSelected: {
    color: '#93c5fd',
    backgroundColor: 'rgba(30,64,175,0.6)',
  },
  countFocused: {
    color: '#a5b4fc',
    backgroundColor: 'rgba(67,56,202,0.5)',
  },
});

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
    width: WHEEL_DIVIDER_W,           // increased gap between the two wheels
    backgroundColor: '#1e293b',
  },
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
                    <Text style={[dropdownStyles.menuItemText, selectedValue === item && dropdownStyles.menuItemTextActive]} numberOfLines={1}>
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

const dropdownStyles = StyleSheet.create({
  container:          { flex: 1, marginHorizontal: 4, justifyContent: 'center' },
  button:             { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(30,41,59,0.8)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: '#334155', columnGap: 6 },
  buttonText:         { flex: 1, fontSize: 12, color: '#f1f5f9', fontWeight: '600' },
  overlay:            { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 100, justifyContent: 'center', alignItems: 'center' },
  menu:               { width: 180, maxHeight: 280, backgroundColor: '#0f172a', borderRadius: 12, borderWidth: 1, borderColor: '#1e293b', overflow: 'hidden', elevation: 10 },
  menuScroll:         { paddingVertical: 6 },
  menuItem:           { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 6, marginHorizontal: 4, marginVertical: 2 },
  menuItemActive:     { backgroundColor: '#1e3a5f' },
  menuItemText:       { fontSize: 12, color: '#94a3b8', fontWeight: '500' },
  menuItemTextActive: { color: '#f1f5f9', fontWeight: '700' },
  menuItemCount:      { fontSize: 10, color: '#64748b', backgroundColor: '#1e293b', paddingHorizontal: 5, borderRadius: 8, overflow: 'hidden' },
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
          style={[
            portraitFilterStyles.chip,
            selectedLanguage === lang && portraitFilterStyles.chipActive,
            selectedLanguage === lang && portraitFilterStyles.chipLangActive,
          ]}
          onPress={() => { onActivity?.(); onLanguageChange(lang); }}
        >
          <Text style={[portraitFilterStyles.chipText, selectedLanguage === lang && portraitFilterStyles.chipTextActive]}>{lang}</Text>
        </Pressable>
      ))}
    </ScrollView>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={portraitFilterStyles.row} keyboardShouldPersistTaps="always">
      {GENRES.map(genre => (
        <Pressable
          key={genre}
          style={[
            portraitFilterStyles.chip,
            selectedGenre === genre && portraitFilterStyles.chipActive,
            selectedGenre === genre && portraitFilterStyles.chipGenreActive,
          ]}
          onPress={() => { onActivity?.(); onGenreChange(genre); }}
        >
          <Text style={[portraitFilterStyles.chipText, selectedGenre === genre && portraitFilterStyles.chipTextActive]}>{genre}</Text>
        </Pressable>
      ))}
    </ScrollView>
  </View>
));

const portraitFilterStyles = StyleSheet.create({
  wrapper:        { backgroundColor: 'rgba(5,10,25,0.98)', borderBottomWidth: 1, borderBottomColor: '#1e293b', paddingVertical: 4 },
  row:            { flexGrow: 0, paddingHorizontal: 8, paddingVertical: 3 },
  chip:           { paddingHorizontal: 11, paddingVertical: 5, backgroundColor: 'rgba(30,41,59,0.7)', borderRadius: 20, marginRight: 6, borderWidth: 1, borderColor: '#1e293b' },
  chipActive:     { borderWidth: 1 },
  chipLangActive: { backgroundColor: 'rgba(29,78,216,0.3)', borderColor: '#3b82f6' },
  chipGenreActive:{ backgroundColor: 'rgba(109,40,217,0.3)', borderColor: '#8b5cf6' },
  chipText:       { color: '#475569', fontSize: 11, fontWeight: '500' },
  chipTextActive: { color: '#fff', fontWeight: '700' },
});

// ─────────────────────────────────────────────────────────────────────────────
// ChannelRow (EPG‑free)
// ─────────────────────────────────────────────────────────────────────────────
interface ChannelRowProps {
  channel: Channel;
  index: number;
  isActive: boolean;
  isFirst: boolean;
  onPress: () => void;
  onActivity?: () => void;
}

const ChannelRow: React.FC<ChannelRowProps> = React.memo(({
  channel, index, isActive, isFirst, onPress, onActivity,
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const hasLogo = !!channel.logo;

  return (
    <Pressable
      focusable
      hasTVPreferredFocus={isFirst && isTV}
      style={[rowStyles.row, isActive && rowStyles.rowActive, isFocused && rowStyles.rowFocused]}
      onPress={onPress}
      onFocus={() => { setIsFocused(true); onActivity?.(); }}
      onBlur={() => { setIsFocused(false); }}
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
      </View>
    </Pressable>
  );
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
    left: 0, top: 0, bottom: 0,
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
    rowGap: 4,
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
  logoCardActive:       { borderColor: '#1d4ed8', backgroundColor: 'rgba(15,23,42,1)' },
  logoImg:              { width: '90%', height: '90%' },
  logoFallback:         { fontSize: isTV ? 9 : 8, color: '#475569', fontWeight: '700', textAlign: 'center', paddingHorizontal: 3 },
  logoFallbackActive:   { color: '#93c5fd' },
  chNum:                { fontSize: isTV ? 11 : 10, color: '#1e3a5f', fontWeight: '800', letterSpacing: 0.4 },
  chNumActive:          { color: '#3b82f6' },
  mainInfo: {
    flex: 1,
    paddingVertical: 12,
    paddingRight: 12,
    justifyContent: 'center',
  },
  nameRow:              { flexDirection: 'row', alignItems: 'center', columnGap: 6 },
  channelName:          { flex: 1, fontSize: isTV ? 16 : 14, fontWeight: '700', color: '#94a3b8', letterSpacing: 0.1 },
  channelNameActive:    { color: '#f1f5f9' },
  badges:               { flexDirection: 'row', alignItems: 'center', columnGap: 4 },
  hdBadge:              { backgroundColor: 'rgba(30,64,175,0.5)', borderRadius: 3, paddingHorizontal: 4, paddingVertical: 1, borderWidth: 1, borderColor: '#1e3a8a' },
  hdBadgeActive:        { backgroundColor: '#1d4ed8', borderColor: '#3b82f6' },
  hdText:               { color: '#93c5fd', fontSize: 8, fontWeight: '900', letterSpacing: 0.5 },
});

// ─────────────────────────────────────────────────────────────────────────────
// PortraitChannelRow (EPG‑free)
// ─────────────────────────────────────────────────────────────────────────────
interface PortraitRowProps {
  channel: Channel;
  index: number;
  isActive: boolean;
  onPress: () => void;
}

const PortraitChannelRow: React.FC<PortraitRowProps> = React.memo(({
  channel, index, isActive, onPress,
}) => {
  const hasLogo = !!channel.logo;

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
      </View>

      <Text style={[portraitRowStyles.chNum, isActive && portraitRowStyles.chNumActive]}>
        {channel.number ?? index + 1}
      </Text>
    </Pressable>
  );
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
  rowActive:          { backgroundColor: 'rgba(29,78,216,0.18)', borderColor: '#1d4ed8', borderWidth: 1.5 },
  activeBar:          { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, backgroundColor: '#3b82f6', zIndex: 2 },
  logoCard:           { width: 52, height: 38, marginLeft: 8, marginRight: 10, borderRadius: 6, backgroundColor: 'rgba(15,23,42,0.9)', borderWidth: 1, borderColor: '#1e293b', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 },
  logoCardActive:     { borderColor: '#1d4ed8' },
  logoImg:            { width: '90%', height: '90%' },
  logoFallback:       { fontSize: 9, color: '#475569', fontWeight: '700', textAlign: 'center', paddingHorizontal: 2 },
  logoFallbackActive: { color: '#93c5fd' },
  info:               { flex: 1, justifyContent: 'center' },
  topRow:             { flexDirection: 'row', alignItems: 'center', columnGap: 5 },
  name:               { flex: 1, fontSize: 13, fontWeight: '700', color: '#94a3b8' },
  nameActive:         { color: '#f1f5f9' },
  hdBadge:            { backgroundColor: 'rgba(30,64,175,0.5)', borderRadius: 3, paddingHorizontal: 4, paddingVertical: 1, borderWidth: 1, borderColor: '#1e3a8a' },
  hdBadgeActive:      { backgroundColor: '#1d4ed8', borderColor: '#3b82f6' },
  hdText:             { color: '#93c5fd', fontSize: 7, fontWeight: '900', letterSpacing: 0.5 },
  chNum:              { fontSize: 10, color: '#1e3a5f', fontWeight: '800', marginLeft: 6, flexShrink: 0 },
  chNumActive:        { color: '#3b82f6' },
});

// ─────────────────────────────────────────────────────────────────────────────
// ChannelListHeader
// ─────────────────────────────────────────────────────────────────────────────
const ChannelListHeader: React.FC<{
  count: number;
  selectedLanguage: string;
  selectedGenre: string;
}> = React.memo(({ count, selectedLanguage, selectedGenre }) => (
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
  </View>
));

const listHeaderStyles = StyleSheet.create({
  container:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10, paddingVertical: 8, backgroundColor: 'rgba(5,10,25,0.98)', borderBottomWidth: 1, borderBottomColor: '#0f172a' },
  left:               { flexDirection: 'row', alignItems: 'center', columnGap: 6, flex: 1 },
  label:              { fontSize: 11, color: '#334155', fontWeight: '700' },
  filterTag:          { flexDirection: 'row', alignItems: 'center', columnGap: 3, backgroundColor: 'rgba(29,78,216,0.2)', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1, borderColor: '#1d4ed8' },
  filterTagGenre:     { backgroundColor: 'rgba(109,40,217,0.2)', borderColor: '#7c3aed' },
  filterTagText:      { fontSize: 10, color: '#60a5fa', fontWeight: '600' },
  filterTagTextGenre: { color: '#a78bfa' },
});

// ─────────────────────────────────────────────────────────────────────────────
// ChannelList — Main
// ─────────────────────────────────────────────────────────────────────────────
interface Props {
  channels: Channel[];
  currentChannel: Channel | null;
  onChannelSelect: (channelNumber: number) => void;
  onActivity?: () => void;
  showEPG?: boolean;
  isLandscape?: boolean;
}
const WINDOW_HALF = 20;

const ChannelList: React.FC<Props> = ({
  channels, currentChannel, onChannelSelect,
  onActivity, isLandscape = false,
}) => {
  const flatListRef = useRef<FlatList>(null);
  const [selectedLanguage, setSelectedLanguage] = useState('All');
  const [selectedGenre,    setSelectedGenre]    = useState('All');
  const [isDropdownOpen,   setIsDropdownOpen]   = useState(false);

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

  const { windowedChannels, windowOffset } = useMemo(() => {
    if (displayChannels.length <= WINDOW_HALF * 2 + 1) {
      return { windowedChannels: displayChannels, windowOffset: 0 };
    }
    const currentIdx = displayChannels.findIndex(ch => ch.id === currentChannel?.id);
    const center = currentIdx === -1 ? 0 : currentIdx;
    const start  = Math.max(0, center - WINDOW_HALF);
    const end    = Math.min(displayChannels.length, center + WINDOW_HALF + 1);
    return {
      windowedChannels: displayChannels.slice(start, end),
      windowOffset: start,
    };
  }, [displayChannels, currentChannel?.id]);

  const showLeftPanel = isTV || isLandscape;

  // One‑shot scroll to current channel on load
  const hasScrolledRef = useRef(false);
  useEffect(() => { hasScrolledRef.current = false; }, [displayChannels.length]);

  const handleLayout = useCallback(() => {
    if (hasScrolledRef.current || !currentChannel || windowedChannels.length === 0) return;
    const idx = windowedChannels.findIndex(ch => ch.id === currentChannel.id);
    if (idx > 0) {
      flatListRef.current?.scrollToIndex({ index: idx, animated: false, viewPosition: 0.3 });
      hasScrolledRef.current = true;
    }
  }, [windowedChannels, currentChannel]);

  const handleLanguageChange = useCallback((lang: string) => {
    setSelectedLanguage(lang);
  }, []);

  const handleGenreChange = useCallback((genre: string) => {
    setSelectedGenre(genre);
  }, []);

  const handleChannelPress = useCallback((channel: Channel, index: number) => {
    onActivity?.();
    onChannelSelect(channel.number ?? index + 1);
  }, [onChannelSelect, onActivity]);

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

  // ── Fixed renderItem — renders the correct row component ──────────────────
  const renderItem = useCallback(
    ({ item, index }: { item: Channel; index: number }) => {
      const realIndex  = windowOffset + index;
      const isActive   = item.id === currentChannel?.id;
      const handlePress = () => handleChannelPress(item, realIndex);

      if (showLeftPanel) {
        return (
          <ChannelRow
            channel={item}
            index={realIndex}
            isActive={isActive}
            isFirst={realIndex === 0}
            onPress={handlePress}
            onActivity={onActivity}
          />
        );
      }
      return (
        <PortraitChannelRow
          channel={item}
          index={realIndex}
          isActive={isActive}
          onPress={handlePress}
        />
      );
    },
    [windowOffset, currentChannel?.id, showLeftPanel, handleChannelPress, onActivity],
  );

  return (
    <View style={[mainStyles.root, isDropdownOpen && { overflow: 'visible' }]}>
      {/* Left side: wheels or dropdowns */}
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

      {/* Right side: list */}
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
            selectedLanguage={selectedLanguage}
            selectedGenre={selectedGenre}
          />
        )}

        <FlatList
          ref={flatListRef}
          data={windowedChannels}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          style={mainStyles.list}
          contentContainerStyle={mainStyles.listContent}
          showsVerticalScrollIndicator={false}
          getItemLayout={getItemLayout}
          onScrollToIndexFailed={handleScrollToIndexFailed}
          onLayout={handleLayout}
          onMomentumScrollEnd={() => onActivity?.()}
          scrollEventThrottle={500}
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

const mainStyles = StyleSheet.create({
  root:          { flex: 1, flexDirection: 'row', backgroundColor: 'rgba(3,7,18,0.92)', borderRadius: isTV ? 16 : 12, borderWidth: 1, borderColor: '#0f172a', overflow: 'hidden' },
  listArea:      { flex: 1, flexDirection: 'column' },
  list:          { flex: 1 },
  listContent:   { paddingVertical: 5, paddingHorizontal: 5 },
  emptyState:    { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, rowGap: 10 },
  emptyTitle:    { fontSize: 15, color: '#374151', fontWeight: '700' },
  emptySubtitle: { fontSize: 12, color: '#1f2937', textAlign: 'center', paddingHorizontal: 20 },
  footer:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 7, backgroundColor: 'rgba(3,7,18,0.98)', borderTopWidth: 1, borderTopColor: '#0f172a' },
  legend:        { flexDirection: 'row', columnGap: 12, alignItems: 'center' },
  legendItem:    { flexDirection: 'row', alignItems: 'center', columnGap: 4 },
  legendDot:     { width: 6, height: 6, borderRadius: 3 },
  legendText:    { color: '#374151', fontSize: 10 },
  footerCount:   { color: '#1e293b', fontSize: 11, fontWeight: '600' },
});

export default ChannelList;