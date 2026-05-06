import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  FlatList,
  ListRenderItemInfo,
} from 'react-native';
import { useChannelContext } from '../../context/ChannelContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Channel } from '../../types/channel';

interface Props {
  onChannelSelect: (channelNumber: number) => void;
}

const CARD_HEIGHT = 180;
const NUM_COLUMNS = 5;

// ─── Memoized Card ───────────────────────────────────────────────────────────

const ChannelCard = React.memo(({
  channel,
  onPress,
}: {
  channel: Channel;
  onPress: (num: number) => void;
}) => {
  const handlePress = useCallback(
    () => onPress(channel.number ?? 0),
    [channel.number, onPress]
  );

  return (
   <TouchableOpacity
  style={styles.card}
  onPress={handlePress}
  activeOpacity={0.8}
  accessible={true}
  accessibilityLabel={`Channel ${channel.number} ${channel.name}`}
  hasTVPreferredFocus={false}
  {...({
    tvParallaxProperties: { enabled: false },
  } as any)}
>
      {/* Image */}
      <View style={styles.imageContainer}>
        {channel.logo ? (
          <Image
            source={{ uri: channel.logo }}
            style={styles.image}
            onError={(e) => console.warn('Image load failed:', e.nativeEvent.error)}
          />
        ) : (
          <View style={styles.imagePlaceholder}>
            <Icon name="television" size={40} color="#6b7280" />
          </View>
        )}
        <View style={styles.imageOverlay} />

        {channel.isFavorite && (
          <View style={styles.favoriteBadge}>
            <Icon name="star" size={12} color="#fff" />
          </View>
        )}
        {channel.isHD && (
          <View style={styles.hdBadge}>
            <Text style={styles.hdText}>HD</Text>
          </View>
        )}
      </View>

      {/* Info */}
      <View style={styles.info}>
        <Text style={styles.channelNumber}>CH {channel.number}</Text>
        <Text style={styles.channelName} numberOfLines={1}>
          {channel.name}
        </Text>
        <View style={styles.tags}>
          <View style={styles.tag}>
            <Text style={styles.tagText}>{channel.group}</Text>
          </View>
          <View style={styles.tag}>
            <Text style={styles.tagText}>{channel.language}</Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
});

// ─── Empty State ─────────────────────────────────────────────────────────────

const EmptyState = React.memo(() => (
  <View style={styles.emptyContainer}>
    <Icon name="magnify" size={80} color="#374151" />
    <Text style={styles.emptyTitle}>No channels found</Text>
    <Text style={styles.emptySubtext}>Try adjusting your filters</Text>
  </View>
));

// ─── Grid ────────────────────────────────────────────────────────────────────

const ChannelGrid: React.FC<Props> = ({ onChannelSelect }) => {
  const { filteredChannels } = useChannelContext();

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Channel>) => (
      <ChannelCard channel={item} onPress={onChannelSelect} />
    ),
    [onChannelSelect]
  );

  const getItemLayout = useCallback(
    (_: ArrayLike<Channel> | null | undefined, index: number) => ({
      length: CARD_HEIGHT,
      offset: CARD_HEIGHT * Math.floor(index / NUM_COLUMNS),
      index,
    }),
    []
  );

  const keyExtractor = useCallback((item: Channel) => item.id, []);

  return (
    <FlatList
      data={filteredChannels}
      keyExtractor={keyExtractor}
      numColumns={NUM_COLUMNS}
      renderItem={renderItem}
      getItemLayout={getItemLayout}
      ListEmptyComponent={EmptyState}
      contentContainerStyle={styles.grid}
      columnWrapperStyle={styles.row}
      removeClippedSubviews={true}
      maxToRenderPerBatch={10}
      updateCellsBatchingPeriod={50}
      windowSize={5}
      initialNumToRender={10}
    />
  );
};

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  grid: {
    paddingHorizontal: 8,
    paddingVertical: 8,
    flexGrow: 1,
  },
  row: {
    justifyContent: 'flex-start',
    marginBottom: 16,
  },
  card: {
    width: '18%',
    marginHorizontal: '1%',
    backgroundColor: '#1f2937',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#374151',
  },
  imageContainer: {
    position: 'relative',
    height: 96,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imagePlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: '#111827',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
  },
  favoriteBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: '#fbbf24',
    borderRadius: 12,
    padding: 4,
  },
  hdBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    backgroundColor: '#2563eb',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  hdText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  info: {
    padding: 12,
  },
  channelNumber: {
    color: '#a78bfa',
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  channelName: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -3,
  },
  tag: {
    backgroundColor: 'rgba(75, 85, 99, 0.5)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#4b5563',
    margin: 3,
  },
  tagText: {
    color: '#d1d5db',
    fontSize: 10,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 80,
  },
  emptyTitle: {
    color: '#6b7280',
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 16,
  },
  emptySubtext: {
    color: '#4b5563',
    fontSize: 16,
    marginTop: 8,
  },
});

export default ChannelGrid;