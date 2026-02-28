export const APP_CONFIG = {
  // M3U Source Configuration
  // You can use:
  // 1. URL: 'https://example.com/playlist.m3u8'
  // 2. Local file in assets: 'channels.m3u8' or 'assets/channels.m3u8'
  // 3. Absolute path: '/storage/emulated/0/Download/playlist.m3u8'
  // 4. File URI: 'file:///path/to/playlist.m3u8'

  APP_NAME: 'IPTV Player',
  M3U_URL: 'channels.m3u8', // Local file in assets by default
  
  // Fallback URL if local file fails
  FALLBACK_M3U_URL: 'https://iptv-org.github.io/iptv/index.m3u',
  
  // App Configuration
  DEFAULT_CHANNEL: 100,
  SPLASH_DURATION: 3000,
  UI_SELECTION_COUNTDOWN: 5,
  CONTROLS_HIDE_DELAY: 5000,
  CHANNELS_PER_PAGE: 10,
  
  // Cache Configuration
  M3U_REFRESH_INTERVAL: 24 * 60 * 60 * 1000, // 24 hours
  ENABLE_CACHE: true,
  MAX_CACHE_AGE: 7 * 24 * 60 * 60 * 1000, // 7 days
  
  // Network Configuration
  REQUEST_TIMEOUT: 30000,
  MAX_RETRIES: 3,
  RETRY_DELAY: 2000,
  
  // Player Configuration
  PLAYER_BUFFER_SIZE: 5000,
  AUTO_PLAY: true,
  RESUME_ON_FOCUS: true,
};

export const STORAGE_KEYS = {
  CACHED_CHANNELS: '@iptv_cached_channels',
  CACHE_TIMESTAMP: '@iptv_cache_timestamp',
  FAVORITES: '@iptv_favorites',
  SELECTED_UI: '@iptv_selected_ui',
  LAST_CHANNEL: '@iptv_last_channel',
  CUSTOM_M3U_URL: '@iptv_custom_m3u_url',
  USER_PREFERENCES: '@iptv_user_preferences',
  WATCH_HISTORY: '@iptv_watch_history',
};

export const ERROR_MESSAGES = {
  NETWORK_ERROR: 'Network error. Please check your internet connection.',
  INVALID_M3U: 'Invalid M3U file format.',
  FILE_NOT_FOUND: 'M3U file not found.',
  EMPTY_PLAYLIST: 'No channels found in playlist.',
  LOAD_FAILED: 'Failed to load channels. Please try again.',
  STREAM_ERROR: 'Failed to play stream. Channel may be offline.',
};