// constants/config.ts

// ─── Defaults (used as Firebase Remote Config defaults + local fallback) ───────
// These are the same values as before — no usage change needed anywhere.

export const APP_CONFIG = {
  APP_NAME: 'RUBY TV',
  API_BASE_URL: 'https://iptv-backend-production-fe47.up.railway.app',
  DEFAULT_CHANNEL: 1,
  SPLASH_DURATION: 100000,
  UI_SELECTION_COUNTDOWN: 5,
  CONTROLS_HIDE_DELAY: 5000,
  CHANNELS_PER_PAGE: 10,
  CHANNEL_REFRESH_INTERVAL: 24 * 60 * 60 * 1000,
  ENABLE_CACHE: true,
  MAX_CACHE_AGE: 7 * 24 * 60 * 60 * 1000,
  REQUEST_TIMEOUT: 30000,
  MAX_RETRIES: 3,
  RETRY_DELAY: 2000,
  PLAYER_BUFFER_SIZE: 5000,
  AUTO_PLAY: true,
  RESUME_ON_FOCUS: true,
};

// NOT making STORAGE_KEYS dynamic — changing keys remotely would corrupt
// existing users' AsyncStorage data.
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

export const ERROR_REPORTING = {
  ENABLED: false,
  API_ENDPOINT: 'https://your-error-reporting-endpoint.com/api/errors',
  TIMEOUT: 5000,
};

// ─── Snapshot of defaults for Remote Config registration ─────────────────────
// Used internally by remoteConfigService — do not import elsewhere.
export const _RC_DEFAULTS = {
  app_config: JSON.stringify(APP_CONFIG),
  error_messages: JSON.stringify(ERROR_MESSAGES),
  error_reporting: JSON.stringify(ERROR_REPORTING),
};