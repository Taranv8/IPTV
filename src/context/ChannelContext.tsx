import React, { createContext, useContext, useState, useEffect, ReactNode, useMemo, useCallback } from 'react';
import { Channel, ChannelFilter } from '../types/channel';
import { useChannels, SyncProgress } from '../hooks/useChannels';
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
  /** Non-null while a fresh channel sync is streaming in over WebSocket. */
  syncProgress: SyncProgress | null;
  setCurrentChannel: (channel: Channel) => void;
  setFilter: (filter: ChannelFilter) => void;
  toggleFavorite: (channelId: string) => void;
  refreshChannels: () => void;
}

const ChannelContext = createContext<ChannelContextType | undefined>(undefined);

export const ChannelProvider = ({ children }: { children: ReactNode }) => {
  const { channels, isLoading, error, syncProgress, refetch } = useChannels();
  const [currentChannel, setCurrentChannel] = useState<Channel | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [filter, setFilter] = useState<ChannelFilter>({
    category: 'All',
    language: 'All',
  });

  // Load saved favorites on mount
useEffect(() => {
  AsyncStorage.getItem(STORAGE_KEYS.FAVORITES)
    .then(val => { if (val) setFavorites(JSON.parse(val)); })
    .catch(err => console.warn('Failed to load favorites:', err));
}, []);
  // Set default channel once channels load
 useEffect(() => {
  if (channels.length > 0) {
    setCurrentChannel(prev => {
      if (prev) return prev;
      return channels.find(ch => ch.number === APP_CONFIG.DEFAULT_CHANNEL) || channels[0];
    });
  }
}, [channels]);

  // Merge favorite state into channels
 const channelsWithFavorites = useMemo(() =>
  channels.map(ch => ({
    ...ch,
    isFavorite: favorites.includes(ch.id),
  })),
  [channels, favorites]
);

const groups = useMemo(() => getGroupsFromChannels(channels), [channels]);

const filteredChannels = useMemo(() =>
  channelsWithFavorites.filter(ch => {
    const matchGroup =
      filter.category === 'All' || ch.group === filter.category;
    const matchLanguage =
      filter.language === 'All' || ch.language === filter.language;
    const matchSearch =
      !filter.search || ch.name.toLowerCase().includes(filter.search.toLowerCase());
    return matchGroup && matchLanguage && matchSearch;
  }),
  [channelsWithFavorites, filter]
);

const toggleFavorite = useCallback(async (channelId: string) => {
  setFavorites(prev => {
    const updated = prev.includes(channelId)
      ? prev.filter(id => id !== channelId)
      : [...prev, channelId];
    AsyncStorage.setItem(STORAGE_KEYS.FAVORITES, JSON.stringify(updated)).catch(
      err => console.warn('Failed to save favorites:', err)
    );
    return updated;
  });
}, []);

 const contextValue = useMemo(() => ({
  channels: channelsWithFavorites,
  filteredChannels,
  currentChannel,
  filter,
  groups,
  isLoading,
  error,
  syncProgress,
  setCurrentChannel,
  setFilter,
  toggleFavorite,
  refreshChannels: refetch,
}), [channelsWithFavorites, filteredChannels, currentChannel, filter, groups, isLoading, error, syncProgress, toggleFavorite, refetch]);

return (
  <ChannelContext.Provider value={contextValue}>
      {children}
    </ChannelContext.Provider>
  );
};

export const useChannelContext = () => {
  const context = useContext(ChannelContext);
  if (!context) throw new Error('useChannelContext must be used within ChannelProvider');
  return context;
};