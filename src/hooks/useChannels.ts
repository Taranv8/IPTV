import { useState, useEffect } from 'react';
import { Channel } from '../types/channel';
import { channelApi } from '../services/api/channelApi';
import { CacheService } from '../services/storage/CacheService';
import { APP_CONFIG } from '../constants/config';

export const useChannels = () => {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchChannels = async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Show cached data immediately for fast startup
      if (APP_CONFIG.ENABLE_CACHE) {
        const cached = await CacheService.getChannels();
        if (cached && cached.length > 0) {
          setChannels(cached);
          setIsLoading(false);
        }
      }

      // Fetch fresh data from MongoDB API
      const freshChannels = await channelApi.getAllChannels();

      if (freshChannels.length === 0) {
        throw new Error('No channels returned from server');
      }

      setChannels(freshChannels);
      await CacheService.saveChannels(freshChannels);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load channels';
      setError(message);

      // Fall back to cache on error
      const cached = await CacheService.getChannels();
      if (cached && cached.length > 0) {
        setChannels(cached);
        setError(message + ' (using cached data)');
      }
    } finally {
      setIsLoading(false);
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
  };
};