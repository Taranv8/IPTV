import { useState, useEffect } from 'react';
import { Channel } from '../types/channel';
import { M3UFetcher } from '../services/m3u/M3UFetcher';
import { M3UParser } from '../services/m3u/M3UParser';
import { CacheService } from '../services/storage/CacheService';

export const useM3U = () => {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchChannels = async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Try to load from cache first
      const cachedChannels = await CacheService.getChannels();
      if (cachedChannels && cachedChannels.length > 0) {
        setChannels(cachedChannels);
        setIsLoading(false);
      }

      // Fetch fresh data
      const m3uContent = await M3UFetcher.fetch();
      const parsedChannels = M3UParser.parse(m3uContent);
      
      setChannels(parsedChannels);
      await CacheService.saveChannels(parsedChannels);
      
      setIsLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load channels');
      setIsLoading(false);
      
      // Try to use cached data on error
      const cachedChannels = await CacheService.getChannels();
      if (cachedChannels && cachedChannels.length > 0) {
        setChannels(cachedChannels);
      }
    }
  };

  const loadFromURL = async (url: string) => {
    try {
      setIsLoading(true);
      setError(null);

      // Fetch M3U content from custom URL
      const m3uContent = await M3UFetcher.fetchFromURL(url);
      
      // Parse the content
      const parsedChannels = M3UParser.parse(m3uContent);

      if (parsedChannels.length === 0) {
        throw new Error('No channels found in M3U file');
      }

      // Update state
      setChannels(parsedChannels);
      
      // Cache the channels
      await CacheService.saveChannels(parsedChannels);
      
      setIsLoading(false);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load channels from URL';
      setError(errorMessage);
      setIsLoading(false);
      throw new Error(errorMessage); // Re-throw to handle in Settings screen
    }
  };

  useEffect(() => {
    fetchChannels();
  }, []);

  return {
    channels,
    isLoading,
    error,
    refetch: fetchChannels,
    loadFromURL,
  };
};