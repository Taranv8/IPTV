import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Channel } from '../../types/channel';
import { useChannelContext } from '../../context/ChannelContext';
import { CATEGORIES, LANGUAGES } from '../../constants/channels';
import { APP_CONFIG } from '../../constants/config';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface Props {
  channels: Channel[];
  currentChannel: Channel | null;
  onChannelSelect: (channelNumber: number) => void;
  channelPage: number;
  setChannelPage: (page: number) => void;
}

const ChannelList: React.FC<Props> = ({
  channels,
  currentChannel,
  onChannelSelect,
  channelPage,
  setChannelPage,
}) => {
  const { filter, setFilter } = useChannelContext();

  const displayedChannels = channels.slice(
    channelPage * APP_CONFIG.CHANNELS_PER_PAGE,
    (channelPage + 1) * APP_CONFIG.CHANNELS_PER_PAGE
  );

  const totalPages = Math.ceil(channels.length / APP_CONFIG.CHANNELS_PER_PAGE);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTitle}>
          <Icon name="television" size={20} color="#fff" />
          <Text style={styles.headerText}>All Channels</Text>
        </View>

        {/* Filters */}
        <View style={styles.filters}>
          <View style={styles.selectContainer}>
            <Icon name="shape" size={14} color="#9ca3af" style={styles.selectIcon} />
           <TouchableOpacity
  style={styles.select}
  onPress={() => {
    setFilter({ ...filter, category: 'Sports' }); // example
    setChannelPage(0);
  }}
>
  <Text style={{ color: '#fff' }}>{filter.category}</Text>
</TouchableOpacity>

          </View>

          <View style={styles.selectContainer}>
            <Icon name="web" size={14} color="#9ca3af" style={styles.selectIcon} />
          <TouchableOpacity
  style={styles.select}
  onPress={() => {
    setFilter({ ...filter, category: 'Sports' }); // example
    setChannelPage(0);
  }}
>
  <Text style={{ color: '#fff' }}>{filter.category}</Text>
</TouchableOpacity>

          </View>
        </View>
      </View>

      {/* Channel List */}
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {displayedChannels.map((channel) => (
          <TouchableOpacity
            key={channel.id}
            style={[
              styles.channelItem,
              currentChannel?.number === channel.number && styles.channelItemActive,
            ]}
            onPress={() => onChannelSelect(channel.number)}
            activeOpacity={0.7}
          >
            <View style={styles.channelInfo}>
              <Text
                style={[
                  styles.channelNumber,
                  currentChannel?.number === channel.number && styles.channelNumberActive,
                ]}
              >
                {channel.number}
              </Text>
              <Text style={styles.channelName} numberOfLines={1}>
                {channel.name}
              </Text>
              {channel.isFavorite && (
                <Icon name="star" size={12} color="#fbbf24" />
              )}
            </View>
            <View style={styles.channelBadges}>
              {channel.isHD && (
                <View style={styles.hdBadge}>
                  <Text style={styles.hdText}>HD</Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Pagination */}
      <View style={styles.pagination}>
        <TouchableOpacity
          style={[styles.paginationButton, channelPage === 0 && styles.paginationButtonDisabled]}
          onPress={() => setChannelPage(Math.max(0, channelPage - 1))}
          disabled={channelPage === 0}
        >
          <Icon name="chevron-left" size={16} color="#fff" />
        </TouchableOpacity>

        <Text style={styles.paginationText}>
          {channelPage * APP_CONFIG.CHANNELS_PER_PAGE + 1}-
          {Math.min((channelPage + 1) * APP_CONFIG.CHANNELS_PER_PAGE, channels.length)} of {channels.length}
        </Text>

        <TouchableOpacity
          style={[
            styles.paginationButton,
            channelPage >= totalPages - 1 && styles.paginationButtonDisabled,
          ]}
          onPress={() => setChannelPage(Math.min(totalPages - 1, channelPage + 1))}
          disabled={channelPage >= totalPages - 1}
        >
          <Icon name="chevron-right" size={16} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
    overflow: 'hidden',
  },
  header: {
    padding: 16,
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
  },
  headerTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  headerText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  filters: {
    gap: 8,
  },
  selectContainer: {
    position: 'relative',
  },
  selectIcon: {
    position: 'absolute',
    left: 12,
    top: 10,
    zIndex: 1,
  },
  select: {
    width: '100%',
    backgroundColor: 'rgba(17, 24, 39, 0.8)',
    color: '#fff',
    fontSize: 14,
    padding: 8,
    paddingLeft: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#374151',
  },
  list: {
    flex: 1,
  },
  listContent: {
    padding: 12,
    gap: 6,
  },
  channelItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(55, 65, 81, 0.5)',
    padding: 10,
    borderRadius: 8,
  },
  channelItemActive: {
    backgroundColor: '#2563eb',
  },
  channelInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  channelNumber: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#3b82f6',
    minWidth: 32,
  },
  channelNumberActive: {
    color: '#fff',
  },
  channelName: {
    fontSize: 14,
    color: '#fff',
    flex: 1,
  },
  channelBadges: {
    flexDirection: 'row',
    gap: 4,
  },
  hdBadge: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  hdText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  pagination: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    backgroundColor: 'rgba(17, 24, 39, 0.8)',
    borderTopWidth: 1,
    borderTopColor: '#1f2937',
  },
  paginationButton: {
    backgroundColor: '#374151',
    padding: 8,
    borderRadius: 8,
  },
  paginationButtonDisabled: {
    opacity: 0.3,
  },
  paginationText: {
    color: '#9ca3af',
    fontSize: 14,
    fontWeight: '500',
  },
});

export default ChannelList;