import axios from 'axios';
import RNFS from 'react-native-fs';
import { APP_CONFIG } from '../../constants/config';
import { Platform } from 'react-native';
export class M3UFetcher {
  /**
   * Fetch M3U from configured source (URL or local file)
   */
  static async fetch(): Promise<string> {
    try {
      // Check if M3U_URL is a local file path
      if (APP_CONFIG.M3U_URL.startsWith('file://') || 
          APP_CONFIG.M3U_URL.startsWith('/') ||
          !APP_CONFIG.M3U_URL.startsWith('http')) {
        return await this.fetchFromLocalFile(APP_CONFIG.M3U_URL);
      }
      
      // Otherwise fetch from URL
      return await this.fetchFromURL(APP_CONFIG.M3U_URL);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Fetch M3U from a URL
   */
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

  /**
   * Fetch M3U from a local file
   */
 static async fetchFromLocalFile(filePath: string): Promise<string> {
  try {
    let resolvedPath = filePath;

    if (filePath.startsWith('file://')) {
      resolvedPath = filePath.replace('file://', '');
    }

    if (!resolvedPath.startsWith('/')) {
      // ✅ Android: use readFileAssets
      if (Platform.OS === 'android') {
        try {
          const content = await RNFS.readFileAssets(resolvedPath, 'utf8');
          if (!content || content.trim() === '') {
            throw new Error('M3U file is empty');
          }
          return content;
        } catch (e) {
          throw new Error(`Asset not found on Android: ${resolvedPath}`);
        }
      }

      // iOS: use MainBundlePath
      const assetPath = `${RNFS.MainBundlePath}/${resolvedPath}`;
      const assetExists = await RNFS.exists(assetPath);
      if (assetExists) {
        resolvedPath = assetPath;
      } else {
        resolvedPath = `${RNFS.DocumentDirectoryPath}/${resolvedPath}`;
      }
    }

    const fileExists = await RNFS.exists(resolvedPath);
    if (!fileExists) {
      throw new Error(`M3U file not found at: ${resolvedPath}`);
    }

    const content = await RNFS.readFile(resolvedPath, 'utf8');

    if (!content || content.trim() === '') {
      throw new Error('M3U file is empty');
    }

    // ✅ Warn instead of throwing
    if (!content.trim().startsWith('#EXTM3U')) {
      console.warn('M3U missing #EXTM3U header, attempting to parse anyway');
    }

    return content;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to read local M3U file: ${error.message}`);
    }
    throw error;
  }
}

  /**
   * Read M3U from app's assets folder (Android)
   */
  static async fetchFromAssets(fileName: string): Promise<string> {
    try {
      // For Android, read from assets
      const assetPath = `${RNFS.MainBundlePath}/${fileName}`;
      const exists = await RNFS.exists(assetPath);
      
      if (!exists) {
        throw new Error(`Asset file not found: ${fileName}`);
      }

      const content = await RNFS.readFile(assetPath, 'utf8');
      
      if (!content.trim().startsWith('#EXTM3U')) {
        throw new Error('Invalid M3U file format');
      }

      return content;
    } catch (error) {
      throw new Error(`Failed to read M3U from assets: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Copy M3U file from assets to documents directory (for first-time setup)
   */
  static async copyAssetToDocuments(assetFileName: string, targetFileName: string): Promise<string> {
    try {
      const sourcePath = `${RNFS.MainBundlePath}/${assetFileName}`;
      const targetPath = `${RNFS.DocumentDirectoryPath}/${targetFileName}`;

      // Check if source exists
      const sourceExists = await RNFS.exists(sourcePath);
      if (!sourceExists) {
        throw new Error(`Source asset not found: ${assetFileName}`);
      }

      // Copy file
      await RNFS.copyFile(sourcePath, targetPath);

      return targetPath;
    } catch (error) {
      throw new Error(`Failed to copy asset: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Save M3U content to local file
   */
  static async saveToFile(content: string, fileName: string): Promise<string> {
    try {
      const filePath = `${RNFS.DocumentDirectoryPath}/${fileName}`;
      
      await RNFS.writeFile(filePath, content, 'utf8');
      
      return filePath;
    } catch (error) {
      throw new Error(`Failed to save M3U file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get list of M3U files in documents directory
   */
  static async getLocalM3UFiles(): Promise<string[]> {
    try {
      const files = await RNFS.readDir(RNFS.DocumentDirectoryPath);
      
      return files
        .filter(file => file.name.endsWith('.m3u') || file.name.endsWith('.m3u8'))
        .map(file => file.name);
    } catch (error) {
      console.error('Failed to list M3U files:', error);
      return [];
    }
  }
}