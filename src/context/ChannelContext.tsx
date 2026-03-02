import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Channel, ChannelFilter } from '../types/channel';
import { useChannels } from '../hooks/useChannels';
import { getGroupsFromChannels } from '../constants/channels';
import { APP_CONFIG, STORAGE_KEYS } from '../constants/config';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface ChannelContextType {
  channels: Channel[];
  filteredChannels: Channel[];
  currentChannel: Channel | null;
  filter: ChannelFilter;
  groups: string[];
  isLoading: boolean;
  error: string | null;
  setCurrentChannel: (channel: Channel) => void;
  setFilter: (filter: ChannelFilter) => void;
  toggleFavorite: (channelId: string) => void;
  refreshChannels: () => void;
}

const ChannelContext = createContext<ChannelContextType | undefined>(undefined);

export const ChannelProvider = ({ children }: { children: ReactNode }) => {
  const { channels, isLoading, error, refetch } = useChannels();
  const [currentChannel, setCurrentChannel] = useState<Channel | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [filter, setFilter] = useState<ChannelFilter>({
    category: 'All',
    language: 'All',
  });

  // Load saved favorites on mount
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEYS.FAVORITES).then(val => {
      if (val) setFavorites(JSON.parse(val));
    });
  }, []);

  // Set default channel once channels load
  useEffect(() => {
    if (channels.length > 0 && !currentChannel) {
      const defaultChannel =
        channels.find(ch => ch.number === APP_CONFIG.DEFAULT_CHANNEL) || channels[0];
      setCurrentChannel(defaultChannel);
    }
  }, [channels]);

  // Merge favorite state into channels
  const channelsWithFavorites = channels.map(ch => ({
    ...ch,
    isFavorite: favorites.includes(ch.id),
  }));

  // Derive groups dynamically from loaded channels
  const groups = getGroupsFromChannels(channels);

  // Filter logic — maps 'category' filter to DB 'group' field
  const filteredChannels = channelsWithFavorites.filter(ch => {
    const matchGroup =
      filter.category === 'All' || ch.group === filter.category;
    const matchLanguage =
      filter.language === 'All' || ch.language === filter.language;
    const matchSearch =
      !filter.search || ch.name.toLowerCase().includes(filter.search.toLowerCase());
    return matchGroup && matchLanguage && matchSearch;
  });

  const toggleFavorite = async (channelId: string) => {
    const updated = favorites.includes(channelId)
      ? favorites.filter(id => id !== channelId)
      : [...favorites, channelId];
    setFavorites(updated);
    await AsyncStorage.setItem(STORAGE_KEYS.FAVORITES, JSON.stringify(updated));
  };

  return (
    <ChannelContext.Provider
      value={{
        channels: channelsWithFavorites,
        filteredChannels,
        currentChannel,
        filter,
        groups,
        isLoading,
        error,
        setCurrentChannel,
        setFilter,
        toggleFavorite,
        refreshChannels: refetch,
      }}
    >
      {children}
    </ChannelContext.Provider>
  );
};

export const useChannelContext = () => {
  const context = useContext(ChannelContext);
  if (!context) throw new Error('useChannelContext must be used within ChannelProvider');
  return context;
};