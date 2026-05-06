import AsyncStorage from '@react-native-async-storage/async-storage';
import { Channel } from '../../types/channel';
import { STORAGE_KEYS, APP_CONFIG } from '../../constants/config';

export interface CacheResult {
  data:  Channel[];
  stale: boolean;
}

export class CacheService {

  static async saveChannels(channels: Channel[]): Promise<void> {
    try {
      await AsyncStorage.multiSet([
        [STORAGE_KEYS.CACHED_CHANNELS, JSON.stringify(channels)],
        [STORAGE_KEYS.CACHE_TIMESTAMP, Date.now().toString()],
      ]);
    } catch (error) {
      console.error('Failed to cache channels:', error);
    }
  }

  static async getChannels(): Promise<CacheResult | null> {
    try {
      const results = await AsyncStorage.multiGet([
        STORAGE_KEYS.CACHED_CHANNELS,
        STORAGE_KEYS.CACHE_TIMESTAMP,
      ]);

      const cached    = results[0][1];
      const timestamp = results[1][1];

      if (!cached || !timestamp) return null;

      const parsed = JSON.parse(cached);
      if (!Array.isArray(parsed)) {
        console.warn('CacheService: corrupt cache — expected array, got:', typeof parsed);
        return null;
      }

      const cacheAge  = Date.now() - parseInt(timestamp, 10);
      const isExpired = cacheAge > APP_CONFIG.CHANNEL_REFRESH_INTERVAL;

      if (isExpired) {
        console.log('CacheService: cache expired — returning stale data as fallback');
      }

      return { data: parsed as Channel[], stale: isExpired };

    } catch (error) {
      console.error('Failed to get cached channels:', error);
      return null;
    }
  }

  static async clearCache(): Promise<void> {
    try {
      await AsyncStorage.multiRemove([
        STORAGE_KEYS.CACHED_CHANNELS,
        STORAGE_KEYS.CACHE_TIMESTAMP,
      ]);
    } catch (error) {
      console.error('Failed to clear cache:', error);
    }
  }
}