import { useState, useEffect } from 'react';
import { Channel } from '../types/channel';
import { M3UFetcher } from '../services/m3u/M3UFetcher';
import { M3UParser } from '../services/m3u/M3UParser';
import { CacheService } from '../services/storage/CacheService';
import { APP_CONFIG } from '../constants/config';

export const useM3U = () => {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sourceType, setSourceType] = useState<'local' | 'url' | 'cache'>('cache');

  const fetchChannels = async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Try to load from cache first for quick startup
      const cachedChannels = await CacheService.getChannels();
      if (cachedChannels && cachedChannels.length > 0) {
        setChannels(cachedChannels);
        setSourceType('cache');
        setIsLoading(false);
      }

      // Determine source type
      const isURL = APP_CONFIG.M3U_URL.startsWith('http://') || 
                    APP_CONFIG.M3U_URL.startsWith('https://');
      
      setSourceType(isURL ? 'url' : 'local');

      // Fetch fresh data
      const m3uContent = await M3UFetcher.fetch();
      const parsedChannels = M3UParser.parse(m3uContent);
      
      if (parsedChannels.length === 0) {
        throw new Error('No channels found in M3U file');
      }

      setChannels(parsedChannels);
      await CacheService.saveChannels(parsedChannels);
      
      setIsLoading(false);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load channels';
      setError(errorMessage);
      console.error('M3U fetch error:', errorMessage);
      
      // Try to use cached data on error
      const cachedChannels = await CacheService.getChannels();
      if (cachedChannels && cachedChannels.length > 0) {
        setChannels(cachedChannels);
        setSourceType('cache');
        setError(errorMessage + ' (using cached data)');
      }
      
      setIsLoading(false);
    }
  };

  const loadFromURL = async (url: string) => {
    try {
      setIsLoading(true);
      setError(null);

      // Validate input
      if (!url || url.trim() === '') {
        throw new Error('Invalid URL or file path');
      }

      let m3uContent: string;

      // Determine if it's a URL or local file
      const isURL = url.startsWith('http://') || url.startsWith('https://');
      
      if (isURL) {
        m3uContent = await M3UFetcher.fetchFromURL(url);
        setSourceType('url');
      } else {
        // Treat as local file path
        m3uContent = await M3UFetcher.fetchFromLocalFile(url);
        setSourceType('local');
      }

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
      const errorMessage = err instanceof Error ? err.message : 'Failed to load channels';
      setError(errorMessage);
      setIsLoading(false);
      throw new Error(errorMessage);
    }
  };

  const loadFromLocalFile = async (filePath: string) => {
    try {
      setIsLoading(true);
      setError(null);

      const m3uContent = await M3UFetcher.fetchFromLocalFile(filePath);
      const parsedChannels = M3UParser.parse(m3uContent);

      if (parsedChannels.length === 0) {
        throw new Error('No channels found in M3U file');
      }

      setChannels(parsedChannels);
      setSourceType('local');
      await CacheService.saveChannels(parsedChannels);
      
      setIsLoading(false);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load local file';
      setError(errorMessage);
      setIsLoading(false);
      throw new Error(errorMessage);
    }
  };

  const downloadAndSave = async (url: string, fileName: string) => {
    try {
      setIsLoading(true);
      setError(null);

      // Download M3U content
      const m3uContent = await M3UFetcher.fetchFromURL(url);
      
      // Save to local file
      const filePath = await M3UFetcher.saveToFile(m3uContent, fileName);
      
      // Parse and update channels
      const parsedChannels = M3UParser.parse(m3uContent);
      
      if (parsedChannels.length === 0) {
        throw new Error('No channels found in downloaded M3U file');
      }

      setChannels(parsedChannels);
      setSourceType('local');
      await CacheService.saveChannels(parsedChannels);
      
      setIsLoading(false);
      
      return filePath;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to download and save M3U';
      setError(errorMessage);
      setIsLoading(false);
      throw new Error(errorMessage);
    }
  };

  const getLocalFiles = async () => {
    try {
      return await M3UFetcher.getLocalM3UFiles();
    } catch (err) {
      console.error('Failed to get local M3U files:', err);
      return [];
    }
  };

  useEffect(() => {
    fetchChannels();
  }, []);

  return {
    channels,
    isLoading,
    error,
    sourceType,
    refetch: fetchChannels,
    loadFromURL,
    loadFromLocalFile,
    downloadAndSave,
    getLocalFiles,
  };
};