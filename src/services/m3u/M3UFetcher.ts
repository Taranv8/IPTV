import axios from 'axios';
import { APP_CONFIG } from '../../constants/config';

export class M3UFetcher {
  static async fetch(): Promise<string> {
    try {
      const response = await axios.get(APP_CONFIG.M3U_URL, {
        timeout: 30000,
        headers: {
          'User-Agent': 'StreamTV/1.0',
        },
      });
      
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Failed to fetch M3U: ${error.message}`);
      }
      throw error;
    }
  }

  static async fetchFromURL(url: string): Promise<string> {
    try {
      // Validate URL format
      if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
        throw new Error('Invalid URL format. URL must start with http:// or https://');
      }

      const response = await axios.get(url, {
        timeout: 30000,
        headers: {
          'User-Agent': 'StreamTV/1.0',
          'Accept': 'application/x-mpegURL, application/vnd.apple.mpegurl, audio/mpegurl, */*',
        },
      });
      
      if (!response.data || typeof response.data !== 'string') {
        throw new Error('Invalid M3U content received');
      }

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNABORTED') {
          throw new Error('Request timeout. Please check your internet connection.');
        } else if (error.response) {
          throw new Error(`Server error: ${error.response.status} - ${error.response.statusText}`);
        } else if (error.request) {
          throw new Error('Network error. Please check your internet connection.');
        }
        throw new Error(`Failed to fetch M3U from URL: ${error.message}`);
      }
      throw error;
    }
  }
}