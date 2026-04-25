// src/components/channel/ChannelList.tsx
import React, { useRef, useCallback, useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ScrollView,
  Platform,
  Image,
  Dimensions,
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

// ─── Layout constants ─────────────────────────────────────────────────────────
const ITEM_HEIGHT = Platform.isTV ? 72 : 64;
const ITEM_GAP    = 4;
const ITEM_TOTAL  = ITEM_HEIGHT + ITEM_GAP;

// Channel icon column width
const CH_COL_W = Platform.isTV ? 140 : 120;

interface Props {
  channels: Channel[];
  currentChannel: Channel | null;
  onChannelSelect: (channelNumber: number) => void;
  channelPage: number;
  setChannelPage: (page: number) => void;
  onActivity?: () => void;
  showEPG?: boolean; // parent can hide EPG on portrait mobile
}

// ─────────────────────────────────────────────────────────────────────────────
// EPG cell — shows program title + progress bar for current program
// ─────────────────────────────────────────────────────────────────────────────
interface EPGCellProps {
  current: EPGProgram | null;
  next: EPGProgram | null;
  isActive: boolean;
  isTV: boolean;
}

const EPGCell: React.FC<EPGCellProps> = ({ current, next, isActive, isTV }) => {
  if (!current && !next) {
    return (
      <View style={epgStyles.cell}>
        <Text style={[epgStyles.noInfo, isActive && epgStyles.noInfoActive]}>
          No information
        </Text>
      </View>
    );
  }

  const progress = current ? getProgramProgress(current) : 0;

  return (
    <View style={epgStyles.cell}>
      {/* Current program */}
      {current && (
        <View style={epgStyles.currentProgram}>
          <View style={epgStyles.programTitleRow}>
            <View style={[epgStyles.liveIndicator, isActive && epgStyles.liveIndicatorActive]} />
            <Text
              style={[epgStyles.programTitle, isActive && epgStyles.programTitleActive]}
              numberOfLines={1}
            >
              {current.title}
            </Text>
          </View>
          <Text style={[epgStyles.programTime, isActive && epgStyles.programTimeActive]}>
            {formatTime(current.startTime)} – {formatTime(current.endTime)}
          </Text>
          {/* Progress bar */}
          <View style={epgStyles.progressBg}>
            <View style={[epgStyles.progressFill, { width: `${progress}%` as any }]} />
          </View>
        </View>
      )}
      {/* Next program */}
      {next && (
        <View style={epgStyles.nextProgram}>
          <Icon name="arrow-right" size={10} color={isActive ? '#93c5fd' : '#4b5563'} />
          <Text
            style={[epgStyles.nextTitle, isActive && epgStyles.nextTitleActive]}
            numberOfLines={1}
          >
            {next.title}
          </Text>
          <Text style={[epgStyles.nextTime, isActive && epgStyles.nextTimeActive]}>
            {formatTime(next.startTime)}
          </Text>
        </View>
      )}
    </View>
  );
};

const epgStyles = StyleSheet.create({
  cell: {
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    justifyContent: 'center',
    gap: 4,
  },
  noInfo: {
    color: '#374151',
    fontSize: 12,
    fontStyle: 'italic',
  },
  noInfoActive: { color: '#6b7280' },
  currentProgram: { gap: 3 },
  programTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  liveIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#ef4444',
  },
  liveIndicatorActive: { backgroundColor: '#f87171' },
  programTitle: {
    color: '#e5e7eb',
    fontSize: Platform.isTV ? 14 : 13,
    fontWeight: '600',
    flex: 1,
  },
  programTitleActive: { color: '#fff' },
  programTime: {
    color: '#6b7280',
    fontSize: 10,
  },
  programTimeActive: { color: '#93c5fd' },
  progressBg: {
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 1,
    overflow: 'hidden',
    marginTop: 2,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#3b82f6',
    borderRadius: 1,
  },
  nextProgram: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  nextTitle: {
    color: '#4b5563',
    fontSize: 10,
    flex: 1,
  },
  nextTitleActive: { color: '#9ca3af' },
  nextTime: {
    color: '#374151',
    fontSize: 10,
  },
  nextTimeActive: { color: '#6b7280' },
});

// ─────────────────────────────────────────────────────────────────────────────
// Channel row — icon column + EPG column
// ─────────────────────────────────────────────────────────────────────────────
interface ChannelRowProps {
  channel: Channel;
  index: number;
  isActive: boolean;
  isFirst: boolean;
  onPress: () => void;
  onActivity?: () => void;
  epgData: Map<string, EPGChannel>;
  showEPG: boolean;
}

const ChannelRow: React.FC<ChannelRowProps> = ({
  channel,
  index,
  isActive,
  isFirst,
  onPress,
  onActivity,
  epgData,
  showEPG,
}) => {
  const [focused, setFocused] = useState(false);
  const isTV = Platform.isTV;
  const { current, next } = getCurrentAndNext(epgData, String(channel.id ?? channel.number));
  const hasIcon = !!channel.logo; // channel.logo: URI string for the channel icon

  return (
    <TouchableOpacity
      style={[
        styles.row,
        isActive && styles.rowActive,
        focused && styles.rowFocused,
      ]}
      onPress={onPress}
      onFocus={() => { setFocused(true); onActivity?.(); }}
      onBlur={() => setFocused(false)}
      activeOpacity={0.85}
      hasTVPreferredFocus={isFirst && isTV}
      accessible
      accessibilityLabel={`Channel ${channel.number ?? index + 1}: ${channel.name}`}
      accessibilityRole="button"
      accessibilityState={{ selected: isActive }}
    >
      {/* ── Selected arrow indicator ── */}
      {isActive && (
        <View style={styles.activeArrow}>
          <Icon name="chevron-right" size={16} color="#3b82f6" />
        </View>
      )}

      {/* ── Channel icon column ── */}
      <View style={[styles.channelCol, { width: CH_COL_W }]}>
        <View style={[
          styles.iconWrapper,
          isActive && styles.iconWrapperActive,
          focused && styles.iconWrapperFocused,
        ]}>
          {/* Channel number badge */}
          <Text style={[
            styles.chNum,
            isActive && styles.chNumActive,
            focused && styles.chNumFocused,
          ]}>
            {channel.number ?? index + 1}
          </Text>

          {/* Logo or fallback */}
          {hasIcon ? (
            <Image
              source={{ uri: channel.logo }}
              style={styles.channelIcon}
              resizeMode="contain"
            />
          ) : (
            <Text
              style={[styles.channelNameFallback, isActive && styles.channelNameFallbackActive]}
              numberOfLines={2}
            >
              {channel.name}
            </Text>
          )}

          {/* Badges */}
          <View style={styles.badgeRow}>
            {channel.isHD && (
              <View style={[styles.hdBadge, isActive && styles.hdBadgeActive]}>
                <Text style={styles.hdText}>HD</Text>
              </View>
            )}
            {channel.isFavorite && (
              <Icon name="star" size={10} color={isActive ? '#fbbf24' : '#78350f'} />
            )}
          </View>
        </View>
      </View>

      {/* ── Divider ── */}
      <View style={styles.divider} />

      {/* ── EPG column ── */}
      {showEPG && (
        <EPGCell
          current={current}
          next={next}
          isActive={isActive}
          isTV={isTV}
        />
      )}

      {/* Portrait mode: show channel name next to icon if no EPG */}
      {!showEPG && (
        <View style={styles.portraitNameCol}>
          <Text
            style={[styles.portraitChannelName, isActive && styles.portraitChannelNameActive]}
            numberOfLines={1}
          >
            {channel.name}
          </Text>
          {current && (
            <Text
              style={[styles.portraitProgram, isActive && styles.portraitProgramActive]}
              numberOfLines={1}
            >
              {current.title}
            </Text>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main ChannelList
// ─────────────────────────────────────────────────────────────────────────────
const ChannelList: React.FC<Props> = ({
  channels,
  currentChannel,
  onChannelSelect,
  onActivity,
  showEPG = true,
}) => {
  const { filter, setFilter, groups } = useChannelContext();
  const flatListRef = useRef<FlatList>(null);
  const isTV = Platform.isTV;

  // ── EPG state ──────────────────────────────────────────────────────────────
  const [epgData, setEpgData] = useState<Map<string, EPGChannel>>(new Map());
  const [epgLoading, setEpgLoading] = useState(false);

  useEffect(() => {
    if (channels.length === 0) return;
    let cancelled = false;
    setEpgLoading(true);
    const ids = channels.map(ch => String(ch.id ?? ch.number));
    fetchEPG(ids).then((data: React.SetStateAction<Map<string, EPGChannel>>) => {
      if (!cancelled) {
        setEpgData(data);
        setEpgLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [channels]);

  // Refresh EPG every 5 minutes while visible
  useEffect(() => {
    const interval = setInterval(() => {
      if (channels.length === 0) return;
      const ids = channels.map(ch => String(ch.id ?? ch.number));
      fetchEPG(ids).then(setEpgData);
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [channels]);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleChannelPress = useCallback(
    (channel: Channel, index: number) => {
      onActivity?.();
      onChannelSelect(channel.number ?? index + 1);
    },
    [onChannelSelect, onActivity],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: Channel; index: number }) => (
      <ChannelRow
        channel={item}
        index={index}
        isActive={currentChannel?.id === item.id}
        isFirst={index === 0}
        onPress={() => handleChannelPress(item, index)}
        onActivity={onActivity}
        epgData={epgData}
        showEPG={showEPG}
      />
    ),
    [currentChannel, handleChannelPress, onActivity, epgData, showEPG],
  );

  const keyExtractor = useCallback(
    (item: Channel, index: number) => item.id ?? `ch-${index}`,
    [],
  );

  const getItemLayout = useCallback(
    (_: any, index: number) => ({
      length: ITEM_HEIGHT,
      offset: ITEM_TOTAL * index,
      index,
    }),
    [],
  );

  const handleScrollToIndexFailed = useCallback(
    (info: { index: number; highestMeasuredFrameIndex: number }) => {
      setTimeout(() => {
        flatListRef.current?.scrollToIndex({
          index: Math.min(info.index, info.highestMeasuredFrameIndex),
          animated: false,
          viewPosition: 0.3,
        });
      }, 100);
    },
    [],
  );

  const handleLayout = useCallback(() => {
    if (!currentChannel || channels.length === 0) return;
    const idx = channels.findIndex(ch => ch.id === currentChannel.id);
    if (idx > 0) {
      flatListRef.current?.scrollToIndex({
        index: idx,
        animated: false,
        viewPosition: 0.3,
      });
    }
  }, [channels, currentChannel]);

  return (
    <View style={styles.container}>
      {/* ── Header ── */}
      <View style={styles.header}>
        {/* Column labels */}
        <View style={styles.colLabels}>
          <View style={[styles.colLabelCh, { width: CH_COL_W }]}>
            <Icon name="television-play" size={14} color="#6b7280" />
            <Text style={styles.colLabelText}>Channel</Text>
          </View>
          <View style={styles.divider} />
          {showEPG ? (
            <View style={styles.colLabelEpg}>
              <Icon name="clock-outline" size={14} color="#6b7280" />
              <Text style={styles.colLabelText}>Now Playing</Text>
              <View style={styles.colLabelSpacer} />
              <Icon name="arrow-right" size={12} color="#4b5563" />
              <Text style={styles.colLabelNextText}>Up Next</Text>
              {epgLoading && (
                <Text style={styles.epgLoadingText}>Updating…</Text>
              )}
            </View>
          ) : (
            <View style={styles.colLabelEpg}>
              <Text style={styles.colLabelText}>{channels.length} Channels</Text>
            </View>
          )}
        </View>

        {/* Category filter chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filtersScroll}
          keyboardShouldPersistTaps="always"
        >
          {groups.map(group => (
            <TouchableOpacity
              key={group}
              style={[
                styles.filterChip,
                filter.category === group && styles.filterChipActive,
              ]}
              onPress={() => { onActivity?.(); setFilter({ ...filter, category: group }); }}
              accessibilityLabel={`Filter: ${group}`}
            >
              <Text style={[
                styles.filterChipText,
                filter.category === group && styles.filterChipTextActive,
              ]}>
                {group}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* ── Channel list ── */}
      <FlatList
        ref={flatListRef}
        data={channels}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        getItemLayout={getItemLayout}
        onScrollToIndexFailed={handleScrollToIndexFailed}
        onLayout={handleLayout}
        onScroll={() => onActivity?.()}
        scrollEventThrottle={16}
        onMomentumScrollBegin={() => onActivity?.()}
        removeClippedSubviews={false}
        windowSize={isTV ? 21 : 7}
        maxToRenderPerBatch={isTV ? 30 : 12}
        initialNumToRender={isTV ? 30 : 15}
        keyboardShouldPersistTaps="always"
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Icon name="television-off" size={40} color="#374151" />
            <Text style={styles.emptyText}>No channels found</Text>
          </View>
        }
      />

      {/* ── Footer ── */}
      <View style={styles.footer}>
        <View style={styles.footerLegend}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#ef4444' }]} />
            <Text style={styles.legendText}>Live</Text>
          </View>
          <View style={styles.legendItem}>
            <Icon name="star" size={10} color="#fbbf24" />
            <Text style={styles.legendText}>Favourite</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#3b82f6' }]} />
            <Text style={styles.legendText}>HD</Text>
          </View>
        </View>
        <Text style={styles.footerCount}>
          {channels.length} ch{filter.category !== 'All' ? ` · ${filter.category}` : ''}
        </Text>
      </View>
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'rgba(3,7,18,0.92)',
    borderRadius: Platform.isTV ? 16 : 12,
    borderWidth: 1,
    borderColor: '#1e293b',
    overflow: 'hidden',
  },

  // ── Header ──────────────────────────────────────────────────────────────────
  header: {
    backgroundColor: 'rgba(15,23,42,0.98)',
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  colLabels: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 0,
  },
  colLabelCh: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingLeft: 4,
  },
  colLabelEpg: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingLeft: 10,
  },
  colLabelSpacer: { flex: 1 },
  colLabelText: {
    color: '#6b7280',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  colLabelNextText: {
    color: '#4b5563',
    fontSize: 10,
    fontWeight: '500',
  },
  epgLoadingText: {
    color: '#3b82f6',
    fontSize: 10,
    marginLeft: 4,
  },
  filtersScroll: {
    flexGrow: 0,
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  filterChip: {
    paddingHorizontal: Platform.isTV ? 16 : 12,
    paddingVertical: Platform.isTV ? 8 : 5,
    backgroundColor: 'rgba(30,41,59,0.8)',
    borderRadius: 20,
    marginRight: 6,
    borderWidth: 1,
    borderColor: '#334155',
  },
  filterChipActive: {
    backgroundColor: '#1d4ed8',
    borderColor: '#3b82f6',
  },
  filterChipText: {
    color: '#64748b',
    fontSize: Platform.isTV ? 13 : 12,
    fontWeight: '500',
  },
  filterChipTextActive: {
    color: '#fff',
    fontWeight: '700',
  },

  // ── List ────────────────────────────────────────────────────────────────────
  list: { flex: 1 },
  listContent: {
    paddingVertical: 6,
    paddingHorizontal: 6,
  },

  // ── Row ─────────────────────────────────────────────────────────────────────
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: ITEM_HEIGHT,
    marginBottom: ITEM_GAP,
    borderRadius: 10,
    backgroundColor: 'rgba(15,23,42,0.6)',
    borderWidth: 1,
    borderColor: 'rgba(30,41,59,0.5)',
    overflow: 'hidden',
    position: 'relative',
  },
  rowActive: {
    backgroundColor: 'rgba(29,78,216,0.25)',
    borderColor: '#3b82f6',
    borderWidth: 1.5,
  },
 rowFocused: {
  backgroundColor: 'rgba(255, 0, 0, 0.12)',   // faded red background
  borderColor: '#ff0000',                       // red border
  borderWidth: 2,
  ...(Platform.isTV ? { transform: [{ scale: 1.01 }] } : {}),
},

  // ── Arrow indicator for active row ──────────────────────────────────────────
  activeArrow: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: '#3b82f6',
    borderTopLeftRadius: 10,
    borderBottomLeftRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 2,
    zIndex: 2,
  },

  // ── Channel icon column ──────────────────────────────────────────────────────
  channelCol: {
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    paddingLeft: 8,
    paddingRight: 4,
  },
  iconWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    width: '100%',
    paddingRight: 4,
  },
  iconWrapperActive: {},
  iconWrapperFocused: {},
  chNum: {
    fontSize: Platform.isTV ? 13 : 11,
    fontWeight: '800',
    color: '#334155',
    minWidth: Platform.isTV ? 30 : 26,
    textAlign: 'center',
  },
  chNumActive: { color: '#60a5fa' },
  chNumFocused: { color: '#64748b' },
  channelIcon: {
    width: Platform.isTV ? 56 : 48,
    height: Platform.isTV ? 36 : 30,
    borderRadius: 4,
    backgroundColor: 'rgba(15,23,42,0.8)',
  },
  channelNameFallback: {
    flex: 1,
    fontSize: Platform.isTV ? 13 : 12,
    fontWeight: '600',
    color: '#64748b',
    lineHeight: 16,
  },
  channelNameFallbackActive: {
    color: '#e2e8f0',
  },
  badgeRow: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: 3,
  },
  hdBadge: {
    backgroundColor: 'rgba(30,64,175,0.6)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: '#1e3a8a',
  },
  hdBadgeActive: {
    backgroundColor: '#1d4ed8',
    borderColor: '#3b82f6',
  },
  hdText: {
    color: '#93c5fd',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.5,
  },

  // ── Divider ─────────────────────────────────────────────────────────────────
  divider: {
    width: 1,
    height: '70%',
    backgroundColor: '#1e293b',
  },

  // ── Portrait fallback (no EPG) ───────────────────────────────────────────────
  portraitNameCol: {
    flex: 1,
    paddingHorizontal: 12,
    justifyContent: 'center',
    gap: 3,
  },
  portraitChannelName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#94a3b8',
  },
  portraitChannelNameActive: { color: '#fff' },
  portraitProgram: {
    fontSize: 11,
    color: '#475569',
  },
  portraitProgramActive: { color: '#60a5fa' },

  // ── Empty state ──────────────────────────────────────────────────────────────
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 12,
  },
  emptyText: {
    color: '#374151',
    fontSize: 14,
  },

  // ── Footer ──────────────────────────────────────────────────────────────────
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(3,7,18,0.98)',
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
  },
  footerLegend: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  legendText: {
    color: '#4b5563',
    fontSize: 10,
  },
  footerCount: {
    color: '#374151',
    fontSize: 11,
  },
});

export default ChannelList;