import AsyncStorage from '@react-native-async-storage/async-storage';
import { Channel } from '../../types/channel';
import { STORAGE_KEYS, APP_CONFIG } from '../../constants/config';

export class CacheService {
  static async saveChannels(channels: Channel[]): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.CACHED_CHANNELS, JSON.stringify(channels));
      await AsyncStorage.setItem(STORAGE_KEYS.CACHE_TIMESTAMP, Date.now().toString());
    } catch (error) {
      console.error('Failed to cache channels:', error);
    }
  }

  static async getChannels(): Promise<Channel[] | null> {
    try {
      const cached = await AsyncStorage.getItem(STORAGE_KEYS.CACHED_CHANNELS);
      const timestamp = await AsyncStorage.getItem(STORAGE_KEYS.CACHE_TIMESTAMP);
      
      if (!cached || !timestamp) return null;
      
      const cacheAge = Date.now() - parseInt(timestamp);
      if (cacheAge > APP_CONFIG.M3U_REFRESH_INTERVAL) {
        return null; // Cache expired
      }
      
      return JSON.parse(cached);
    } catch (error) {
      console.error('Failed to get cached channels:', error);
      return null;
    }
  }

  static async clearCache(): Promise<void> {
    try {
      await AsyncStorage.removeItem(STORAGE_KEYS.CACHED_CHANNELS);
      await AsyncStorage.removeItem(STORAGE_KEYS.CACHE_TIMESTAMP);
    } catch (error) {
      console.error('Failed to clear cache:', error);
    }
  }
}