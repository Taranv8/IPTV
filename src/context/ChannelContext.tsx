import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Channel, ChannelFilter } from '../types/channel';
import { useM3U } from '../hooks/useM3U';
import { CATEGORIES, LANGUAGES } from '../constants/channels';
import { APP_CONFIG, STORAGE_KEYS } from '../constants/config';

interface ChannelContextType {
  channels: Channel[];
  filteredChannels: Channel[];
  currentChannel: Channel | null;
  filter: ChannelFilter;
  isLoading: boolean;
  error: string | null;
  setCurrentChannel: (channel: Channel) => void;
  setFilter: (filter: ChannelFilter) => void;
  toggleFavorite: (channelId: string) => void;
  refreshChannels: () => void;
  loadChannelsFromURL: (url: string) => Promise<void>;
}

const ChannelContext = createContext<ChannelContextType | undefined>(undefined);

export const ChannelProvider = ({ children }: { children: ReactNode }) => {
  const { channels, isLoading, error, refetch, loadFromURL } = useM3U();
  const [currentChannel, setCurrentChannel] = useState<Channel | null>(null);
  const [filter, setFilter] = useState<ChannelFilter>({
    category: 'All',
    language: 'All',
  });

  const filteredChannels = channels.filter(ch => 
    (filter.category === 'All' || ch.category === filter.category) &&
    (filter.language === 'All' || ch.language === filter.language) &&
    (!filter.search || ch.name.toLowerCase().includes(filter.search.toLowerCase()))
  );

  useEffect(() => {
    if (channels.length > 0 && !currentChannel) {
      const defaultChannel = channels.find(ch => ch.number === APP_CONFIG.DEFAULT_CHANNEL) || channels[0];
      setCurrentChannel(defaultChannel);
    }
  }, [channels, currentChannel]);

  const toggleFavorite = (channelId: string) => {
    // Implementation in AsyncStorageService
  };

  const refreshChannels = () => {
    refetch();
  };

  const loadChannelsFromURL = async (url: string) => {
    try {
      // Validate URL
      if (!url || url.trim() === '') {
        throw new Error('Invalid URL');
      }

      // Check if it's a valid URL or file path
      const isURL = url.startsWith('http://') || url.startsWith('https://');
      
      if (isURL) {
        // Load from URL using the useM3U hook's loadFromURL method
        await loadFromURL(url);
        
        // Save the custom URL for future use
        await AsyncStorage.setItem('@iptv_custom_m3u_url', url);
      } else {
        // Handle local file path (if needed)
        throw new Error('Local file loading not yet implemented');
      }
    } catch (error) {
      console.error('Error loading channels from URL:', error);
      throw error;
    }
  };

  return (
    <ChannelContext.Provider
      value={{
        channels,
        filteredChannels,
        currentChannel,
        filter,
        isLoading,
        error,
        setCurrentChannel,
        setFilter,
        toggleFavorite,
        refreshChannels,
        loadChannelsFromURL,
      }}
    >
      {children}
    </ChannelContext.Provider>
  );
};

export const useChannelContext = () => {
  const context = useContext(ChannelContext);
  if (!context) {
    throw new Error('useChannelContext must be used within ChannelProvider');
  }
  return context;
};