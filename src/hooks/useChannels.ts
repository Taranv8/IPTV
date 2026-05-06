import { useState, useEffect, useCallback, useRef } from 'react';
import { Channel } from '../types/channel';
import { channelApi } from '../services/api/channelApi';
import { CacheService } from '../services/storage/CacheService';
import { APP_CONFIG } from '../constants/config';

export const useChannels = () => {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [isLoading, setIsLoading] = useState(APP_CONFIG.ENABLE_CACHE ? false : true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchChannels = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const { signal } = abortRef.current;

    try {
      setIsLoading(true);
      setError(null);

      if (APP_CONFIG.ENABLE_CACHE) {
const cached = await CacheService.getChannels();
if (cached && cached.data.length > 0 && !signal.aborted) {
  setChannels(cached.data);
  if (!cached.stale) setIsLoading(false);
}
      }

      const freshChannels = await channelApi.getAllChannels();

      if (freshChannels.length === 0) {
        throw new Error('No channels returned from server');
      }

      if (!signal.aborted) {
        setChannels(freshChannels);
        await CacheService.saveChannels(freshChannels);
      }
    } catch (err) {
      if (signal.aborted) return;

      const message = err instanceof Error ? err.message : 'Failed to load channels';

      try {
       const cached = await CacheService.getChannels();
if (cached && cached.data.length > 0) {
  setChannels(cached.data);
  setError(message + ' (using cached data)');
  return;
}
      } catch {
        // cache also failed, fall through to set raw error
      }

      setError(message);
    } finally {
      if (!signal.aborted) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchChannels();
    return () => { abortRef.current?.abort(); };
  }, [fetchChannels]);

  return {
    channels,
    isLoading,
    error,
    refetch: fetchChannels,
  };
};