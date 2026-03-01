// constants/config.ts

export const APP_CONFIG = {
  APP_NAME: 'IPTV Player',
  M3U_URL: 'channels.m3u8',
  FALLBACK_M3U_URL: 'https://iptv-org.github.io/iptv/index.m3u',
  DEFAULT_CHANNEL: 100,
  SPLASH_DURATION: 3000,
  UI_SELECTION_COUNTDOWN: 5,
  CONTROLS_HIDE_DELAY: 5000,
  CHANNELS_PER_PAGE: 10,
  M3U_REFRESH_INTERVAL: 24 * 60 * 60 * 1000,
  ENABLE_CACHE: true,
  MAX_CACHE_AGE: 7 * 24 * 60 * 60 * 1000,
  REQUEST_TIMEOUT: 30000,
  MAX_RETRIES: 3,
  RETRY_DELAY: 2000,
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

// ✅ THIS WAS MISSING — ErrorReporter imports this but it was never defined
export const ERROR_REPORTING = {
  // Set to true to enable remote error reporting
  ENABLED: false,

  // Replace with your error reporting endpoint when ready
  // e.g. 'https://your-api.com/errors' or a Sentry/Datadog ingest URL
  API_ENDPOINT: 'https://your-error-reporting-endpoint.com/api/errors',

  // Request timeout for error reports (ms)
  TIMEOUT: 5000,
};