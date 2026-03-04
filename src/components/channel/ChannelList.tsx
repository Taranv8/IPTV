// src/components/channel/ChannelList.tsx
import React, { useRef, useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ScrollView,
  Platform,
} from 'react-native';
import { Channel } from '../../types/channel';
import { useChannelContext } from '../../context/ChannelContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

// ─── Item height must be a fixed constant so getItemLayout can calculate
//     offsets without measuring. Keep in sync with channelItem styles below.
const ITEM_HEIGHT = 44;   // paddingVertical(10)*2 + fontSize(13)*~1.2 + gap(5)
const ITEM_GAP    = 5;    // matches listContent gap
const ITEM_TOTAL  = ITEM_HEIGHT + ITEM_GAP;

interface Props {
  channels: Channel[];
  currentChannel: Channel | null;
  onChannelSelect: (channelNumber: number) => void;
  channelPage: number;
  setChannelPage: (page: number) => void;
  // Called on every user interaction so the parent can reset the hide timer
  onActivity?: () => void;
}

// ─── Single channel row ───────────────────────────────────────────────────────
interface ChannelItemProps {
  channel: Channel;
  index: number;
  isActive: boolean;
  isFirst: boolean;
  onPress: () => void;
  onActivity?: () => void; // bubble up D-pad focus moves to parent timer
}

const ChannelItemRow: React.FC<ChannelItemProps> = ({
  channel,
  index,
  isActive,
  isFirst,
  onPress,
  onActivity,
}) => {
  const [focused, setFocused] = useState(false);
  const isTV = Platform.isTV;

  return (
    <TouchableOpacity
      style={[
        styles.channelItem,
        isActive && styles.channelItemActive,
        focused && styles.channelItemFocused,
      ]}
      onPress={onPress}
      onFocus={() => { setFocused(true); onActivity?.(); }}
      onBlur={() => setFocused(false)}
      activeOpacity={0.7}
      hasTVPreferredFocus={isFirst && isTV}
      accessible={true}
      accessibilityLabel={`Channel ${channel.number ?? index + 1}: ${channel.name}`}
      accessibilityRole="button"
      accessibilityState={{ selected: isActive }}
    >
      <View style={styles.channelInfo}>
        <Text
          style={[
            styles.channelNumber,
            isActive && styles.channelNumberActive,
            focused && styles.channelNumberFocused,
          ]}
        >
          {channel.number ?? index + 1}
        </Text>
        <Text
          style={[styles.channelName, (isActive || focused) && styles.channelNameActive]}
          numberOfLines={1}
        >
          {channel.name}
        </Text>
        {channel.isFavorite && <Icon name="star" size={12} color="#fbbf24" />}
      </View>
      <View style={styles.channelBadges}>
        {channel.isHD && (
          <View style={[styles.hdBadge, focused && styles.hdBadgeFocused]}>
            <Text style={styles.hdText}>HD</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
};

// ─── Main ChannelList ─────────────────────────────────────────────────────────
const ChannelList: React.FC<Props> = ({
  channels,
  currentChannel,
  onChannelSelect,
  onActivity,
}) => {
  const { filter, setFilter, groups } = useChannelContext();
  const flatListRef = useRef<FlatList>(null);
  const isTV = Platform.isTV;

  const handleChannelPress = useCallback(
    (channel: Channel, index: number) => {
      onActivity?.();
      onChannelSelect(channel.number ?? index + 1);
    },
    [onChannelSelect, onActivity],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: Channel; index: number }) => (
      <ChannelItemRow
        channel={item}
        index={index}
        isActive={currentChannel?.id === item.id}
        isFirst={index === 0}
        onPress={() => handleChannelPress(item, index)}
        onActivity={onActivity}
      />
    ),
    [currentChannel, handleChannelPress, onActivity],
  );

  const keyExtractor = useCallback(
    (item: Channel, index: number) => item.id ?? `ch-${index}`,
    [],
  );

  // ─── getItemLayout ────────────────────────────────────────────────────────
  // Tells FlatList exact pixel offset of every item without measuring.
  // Required when using scrollToIndex for off-screen items.
  const getItemLayout = useCallback(
    (_data: ArrayLike<Channel> | null | undefined, index: number) => ({
      length: ITEM_HEIGHT,
      offset: ITEM_TOTAL * index,
      index,
    }),
    [],
  );

  // ─── onScrollToIndexFailed ────────────────────────────────────────────────
  // Safety net: if scrollToIndex still can't find the item (e.g. list not yet
  // laid out), scroll to the nearest known position instead of crashing.
  const handleScrollToIndexFailed = useCallback(
    (info: { index: number; highestMeasuredFrameIndex: number; averageItemLength: number }) => {
      const wait = new Promise<void>(resolve => setTimeout(() => resolve(), 100));
      wait.then(() => {
        flatListRef.current?.scrollToIndex({
          index: Math.min(info.index, info.highestMeasuredFrameIndex),
          animated: false,
          viewPosition: 0.3,
        });
      });
    },
    [],
  );

  // ─── Auto-scroll to current channel on layout ─────────────────────────────
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
        <View style={styles.headerTitle}>
          <Icon name="television" size={18} color="#fff" />
          <Text style={styles.headerText}>
            All Channels ({channels.length})
          </Text>
        </View>

        {/* ── Category filter chips ── */}
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
              <Text
                style={[
                  styles.filterChipText,
                  filter.category === group && styles.filterChipTextActive,
                ]}
              >
                {group}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* ── Channel FlatList ── */}
      <FlatList
        ref={flatListRef}
        data={channels}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        // ── Fixes scrollToIndex crash ──────────────────────────────────────
        getItemLayout={getItemLayout}
        onScrollToIndexFailed={handleScrollToIndexFailed}
        // ── Auto-scroll to active channel ─────────────────────────────────
        onLayout={handleLayout}
        // ── Reset parent timer on ANY scroll interaction ───────────────────
        // onScroll fires while finger is dragging; throttled to ~60fps
        onScroll={() => onActivity?.()}
        scrollEventThrottle={16}
        // onMomentumScrollBegin catches TV D-pad fast-scroll
        onMomentumScrollBegin={() => onActivity?.()}
        // ── TV-critical props ──────────────────────────────────────────────
        removeClippedSubviews={false}
        windowSize={isTV ? 21 : 5}
        maxToRenderPerBatch={isTV ? 30 : 10}
        initialNumToRender={isTV ? 30 : 15}
        keyboardShouldPersistTaps="always"
      />

      {/* ── Footer ── */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          {channels.length} channel{channels.length !== 1 ? 's' : ''}
          {filter.category !== 'All' ? ` · ${filter.category}` : ''}
        </Text>
      </View>
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1f2937',
    overflow: 'hidden',
  },
  header: {
    padding: 12,
    backgroundColor: 'rgba(59,130,246,0.15)',
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
  },
  headerTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  headerText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  filtersScroll: {
    flexGrow: 0,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    backgroundColor: 'rgba(55,65,81,0.5)',
    borderRadius: 16,
    marginRight: 6,
    borderWidth: 1,
    borderColor: '#374151',
  },
  filterChipActive: {
    backgroundColor: '#2563eb',
    borderColor: '#3b82f6',
  },
  filterChipText: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '500',
  },
  filterChipTextActive: {
    color: '#fff',
  },
  list: {
    flex: 1,
  },
  listContent: {
    padding: 10,
    gap: ITEM_GAP,
  },

  // ── Channel row — height MUST match ITEM_HEIGHT constant above ────────────
  channelItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(55,65,81,0.5)',
    paddingHorizontal: 10,
    height: ITEM_HEIGHT,      // ← fixed height, matches getItemLayout
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  channelItemActive: {
    backgroundColor: '#2563eb',
    borderColor: '#3b82f6',
  },
  channelItemFocused: {
    backgroundColor: 'rgba(59,130,246,0.35)',
    borderColor: '#60a5fa',
  },
  channelInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 10,
  },
  channelNumber: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#3b82f6',
    minWidth: 30,
  },
  channelNumberActive: { color: '#fff' },
  channelNumberFocused: { color: '#93c5fd' },
  channelName: {
    fontSize: 13,
    color: '#d1d5db',
    flex: 1,
  },
  channelNameActive: { color: '#fff' },
  channelBadges: {
    flexDirection: 'row',
    gap: 4,
  },
  hdBadge: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 3,
  },
  hdBadgeFocused: { backgroundColor: '#60a5fa' },
  hdText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: 'bold',
  },
  footer: {
    padding: 10,
    backgroundColor: 'rgba(17,24,39,0.9)',
    borderTopWidth: 1,
    borderTopColor: '#1f2937',
    alignItems: 'center',
  },
  footerText: {
    color: '#6b7280',
    fontSize: 12,
  },
});

export default ChannelList;