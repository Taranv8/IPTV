export const APP_CONFIG = {
  // M3U Configuration
  M3U_URL: 'https://your-m3u-playlist-url.m3u8',
  M3U_REFRESH_INTERVAL: 3600000, // 1 hour in milliseconds
  
  // UI Configuration
  SPLASH_DURATION: 3000, // 3 seconds
  SELECTION_COUNTDOWN: 5, // 5 seconds
  CONTROLS_HIDE_DELAY: 5000, // 5 seconds
  
  // Channel Configuration
  DEFAULT_CHANNEL: 100,
  CHANNELS_PER_PAGE: 10,
  MIN_CHANNEL_NUMBER: 100,
  MAX_CHANNEL_NUMBER: 500,
  
  // App Info
  APP_NAME: 'StreamTV',
  VERSION: '1.0.0',
};

export const ERROR_REPORTING = {
  ENABLED: true,
  API_ENDPOINT: 'https://your-error-reporting-endpoint.com/api/errors',
  MAX_RETRIES: 3,
  TIMEOUT: 10000,
};

export const STORAGE_KEYS = {
  FAVORITES: '@iptv_favorites',
  UI_MODE: '@iptv_ui_mode',
  LAST_CHANNEL: '@iptv_last_channel',
  CACHED_CHANNELS: '@iptv_cached_channels',
  CACHE_TIMESTAMP: '@iptv_cache_timestamp',
};