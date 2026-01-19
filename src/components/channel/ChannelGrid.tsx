import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { useChannelContext } from '../../context/ChannelContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface Props {
  onChannelSelect: (channelNumber: number) => void;
}

const ChannelGrid: React.FC<Props> = ({ onChannelSelect }) => {
  const { filteredChannels } = useChannelContext();

  if (filteredChannels.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Icon name="magnify" size={80} color="#374151" />
        <Text style={styles.emptyTitle}>No channels found</Text>
        <Text style={styles.emptySubtext}>Try adjusting your filters</Text>
      </View>
    );
  }

  return (
    <View style={styles.grid}>
      {filteredChannels.map((channel) => (
        <TouchableOpacity
          key={channel.id}
          style={styles.card}
          onPress={() => onChannelSelect(channel.number)}
          activeOpacity={0.8}
        >
          {/* Channel Image */}
          <View style={styles.imageContainer}>
            {channel.logo ? (
              <Image source={{ uri: channel.logo }} style={styles.image} />
            ) : (
              <View style={styles.imagePlaceholder}>
                <Icon name="television" size={40} color="#6b7280" />
              </View>
            )}
            <View style={styles.imageOverlay} />
            
            {/* Badges */}
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

          {/* Channel Info */}
          <View style={styles.info}>
            <Text style={styles.channelNumber}>CH {channel.number}</Text>
            <Text style={styles.channelName} numberOfLines={1}>
              {channel.name}
            </Text>
            <View style={styles.tags}>
              <View style={styles.tag}>
                <Text style={styles.tagText}>{channel.category}</Text>
              </View>
              <View style={styles.tag}>
                <Text style={styles.tagText}>{channel.language}</Text>
              </View>
            </View>
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  card: {
    width: '18%',
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
    gap: 6,
    flexWrap: 'wrap',
  },
  tag: {
    backgroundColor: 'rgba(75, 85, 99, 0.5)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#4b5563',
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