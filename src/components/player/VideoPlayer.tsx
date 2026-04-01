// src/components/player/VideoPlayer.tsx
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Text,
  Platform,
  AppState,
  AppStateStatus,
} from 'react-native';
import Video, { OnLoadData, OnProgressData, DRMType } from 'react-native-video';
import { Channel } from '../../types/channel';
import { StreamResolver, ResolvedStream, DRMConfig } from '../../services/stream/StreamResolver';

// ─── Constants ────────────────────────────────────────────────────────────────

const STALL_TIMEOUT_MS  = 8_000;
const RETRY_INTERVAL_MS = 5_000;

const EXO_ERROR_BEHIND_LIVE_WINDOW = 21002;
const EXO_ERROR_BAD_HTTP_STATUS    = 22004;

const BUFFER_CONFIG = {
  minBufferMs:                      3_000,
  maxBufferMs:                     10_000,
  bufferForPlaybackMs:              2_000,
  bufferForPlaybackAfterRebufferMs: 3_000,
  backBufferDurationMs:                 0,
  cacheSizeMb:                          0,
} as const;

const ACCEPT_HEADER =
  'application/x-mpegURL, application/vnd.apple.mpegurl, audio/mpegurl, application/dash+xml, video/mp4, */*';

// ─── DRM type mapper ──────────────────────────────────────────────────────────
//
// react-native-video uses the DRMType enum for the `drm.type` prop.
// Our internal DRMConfig uses plain string literals — map them here.

function toDRMTypeProp(config: DRMConfig): {
  type: DRMType;
  clearkeys?: Record<string, string>;
  licenseServer?: string;
  headers?: Record<string, string>;
} {
  switch (config.type) {
    case 'clearkey':
      return {
        type: DRMType.CLEARKEY,
        clearkeys: config.clearkeys,
      };
    case 'widevine':
      return {
        type: DRMType.WIDEVINE,
        licenseServer: config.licenseServer,
        headers: config.headers,
      };
    case 'playready':
      return {
        type: DRMType.PLAYREADY,
        licenseServer: config.licenseServer,
        headers: config.headers,
      };
  }
}

// ─── ErrorReporter shim ───────────────────────────────────────────────────────

async function safeReport(message: string, code: string, extras: Record<string, unknown>) {
  try {
    const mod      = require('../../services/error/ErrorReporter');
    const reporter = mod?.ErrorReporter ?? mod?.default;
    if (reporter && typeof reporter.report === 'function') {
      await reporter.report(new Error(message), code, extras);
    }
  } catch {}
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props { channel: Channel }

// ─── Component ────────────────────────────────────────────────────────────────

const VideoPlayer: React.FC<Props> = ({ channel }) => {

  const [stream,           setStream]           = useState<ResolvedStream | null>(null);
  const [isSpinnerVisible, setIsSpinnerVisible] = useState(true);
  const [spinnerLabel,     setSpinnerLabel]     = useState('Resolving stream…');

  // Track which streamUrls index we are currently trying so we can fall back
  // to the next source on repeated failure.
  const streamIndexRef   = useRef(0);

  const videoRef         = useRef<any>(null);
  const cancelledRef     = useRef(false);
  const stallTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef    = useRef(0);
  const scheduleRetryRef = useRef<() => void>(() => {});

  // ── AppState ──────────────────────────────────────────────────────────────
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const [appActive, setAppActive] = useState(true);

  useEffect(() => {
    const sub = AppState.addEventListener('change', next => {
      const was = appStateRef.current === 'active';
      const now = next === 'active';
      appStateRef.current = next;
      if (was !== now) setAppActive(now);
    });
    return () => sub.remove();
  }, []);

  // ── Timer helpers ─────────────────────────────────────────────────────────

  const clearStallTimer = useCallback(() => {
    if (stallTimerRef.current !== null) {
      clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
    }
  }, []);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const clearAllTimers = useCallback(() => {
    clearStallTimer();
    clearRetryTimer();
  }, [clearStallTimer, clearRetryTimer]);

  // ── Live-edge seek ────────────────────────────────────────────────────────

  const seekToLiveEdge = useCallback(() => {
    if (!videoRef.current || cancelledRef.current) return;
    console.log('[VideoPlayer] 🔁 Seeking to live edge (BEHIND_LIVE_WINDOW recovery)');
    try {
      videoRef.current.seek(Number.MAX_SAFE_INTEGER);
    } catch (e) {
      console.warn('[VideoPlayer] seekToLiveEdge failed, falling back to reconnect:', e);
      reconnect();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Source picker ─────────────────────────────────────────────────────────
  //
  // Returns the StreamUrl entry that should be used for the next attempt.
  // Cycles through channel.streamUrls so transient source failures can
  // automatically fall back to an alternative source.

  const pickNextSource = useCallback(() => {
    const urls = channel.streamUrls ?? [];
    if (urls.length === 0) return null;

    // After every MAX_RETRIES_PER_SOURCE attempts, advance to the next source.
    const MAX_RETRIES_PER_SOURCE = 3;
    const idx = Math.floor(retryCountRef.current / MAX_RETRIES_PER_SOURCE) % urls.length;
    if (idx !== streamIndexRef.current) {
      console.log(
        `[VideoPlayer] 🔀 Switching to source #${idx} ("${urls[idx]?.source ?? 'unknown'}")`,
      );
      streamIndexRef.current = idx;
    }
    return urls[idx] ?? null;
  }, [channel.streamUrls]);

  // ── Full reconnect ────────────────────────────────────────────────────────

  const reconnect = useCallback(async () => {
    if (cancelledRef.current) return;

    retryCountRef.current += 1;
    const attempt = retryCountRef.current;
    console.log(`[VideoPlayer] 🔄 Reconnect #${attempt} — "${channel.name}"`);

    setIsSpinnerVisible(true);
    setSpinnerLabel(`Reconnecting… (attempt ${attempt})`);

    const sourceEntry = pickNextSource();
    if (!sourceEntry) {
      console.warn('[VideoPlayer] No stream sources available');
      scheduleRetryRef.current();
      return;
    }

    let resolved: ResolvedStream | null = null;
    try {
      resolved = await StreamResolver.resolve(sourceEntry);
    } catch (e: any) {
      console.warn(`[VideoPlayer] ❌ Reconnect #${attempt} threw:`, e?.message ?? e);
    }

    if (cancelledRef.current) return;

    if (resolved) {
      console.log(`[VideoPlayer] ✅ Reconnect #${attempt} → ${resolved.type}:`, resolved.url);
      setStream({ ...resolved });
      setIsSpinnerVisible(true);
      setSpinnerLabel('Loading channel…');
    } else {
      scheduleRetryRef.current();
    }
  }, [channel.name, pickNextSource]);

  const scheduleNextRetry = useCallback(() => {
    if (cancelledRef.current) return;
    clearRetryTimer();
    console.log(`[VideoPlayer] ⏱ Retry in ${RETRY_INTERVAL_MS / 1000}s`);
    retryTimerRef.current = setTimeout(() => {
      if (!cancelledRef.current) reconnect();
    }, RETRY_INTERVAL_MS);
  }, [clearRetryTimer, reconnect]);

  useEffect(() => { scheduleRetryRef.current = scheduleNextRetry; }, [scheduleNextRetry]);

  // ── Stall watchdog ────────────────────────────────────────────────────────

  const startStallWatchdog = useCallback(() => {
    clearStallTimer();
    stallTimerRef.current = setTimeout(() => {
      if (cancelledRef.current) return;
      console.warn(`[VideoPlayer] ⚠️ Stalled ${STALL_TIMEOUT_MS / 1000}s — reconnecting`);
      reconnect();
    }, STALL_TIMEOUT_MS);
  }, [clearStallTimer, reconnect]);

  // ── Initial resolution ────────────────────────────────────────────────────

  useEffect(() => {
    cancelledRef.current = true;
    clearAllTimers();

    cancelledRef.current  = false;
    retryCountRef.current = 0;
    streamIndexRef.current = 0;

    setStream(null);
    setIsSpinnerVisible(true);
    setSpinnerLabel('Resolving stream…');

    console.log(`[VideoPlayer] ── Channel: "${channel.name}" → ${channel.streamUrl}`);

    // Use the full StreamUrl entry (with DRM/headers) if available,
    // otherwise fall back to the plain streamUrl string.
    const initialSource = channel.streamUrls?.[0] ?? channel.streamUrl;

    (async () => {
      let resolved: ResolvedStream | null = null;
      try {
        resolved = await StreamResolver.resolve(initialSource);
      } catch (e: any) {
        console.error('[VideoPlayer] Initial resolve threw:', e?.message ?? e);
      }

      if (cancelledRef.current) return;

      if (resolved) {
        console.log(`[VideoPlayer] Initial → ${resolved.type}:`, resolved.url);
        if (resolved.drm) {
          console.log('[VideoPlayer] DRM:', resolved.drm.type, resolved.drm);
        }
        setStream(resolved);
        setSpinnerLabel('Loading channel…');
      } else {
        reconnect();
      }
    })();

    return () => {
      cancelledRef.current = true;
      clearAllTimers();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.streamUrl]);

  // ── ExoPlayer callbacks ───────────────────────────────────────────────────

  const handleLoadStart = useCallback(() => {
    clearStallTimer();
  }, [clearStallTimer]);

  const handleLoad = useCallback((_: OnLoadData) => {
    if (cancelledRef.current) return;
    clearAllTimers();
    setIsSpinnerVisible(false);
    console.log(`[VideoPlayer] ▶️  Playing "${channel.name}"`);
  }, [clearAllTimers, channel.name]);

  const handleBuffer = useCallback(({ isBuffering }: { isBuffering: boolean }) => {
    if (cancelledRef.current) return;
    if (!isBuffering) {
      clearStallTimer();
      setIsSpinnerVisible(false);
      return;
    }
    setIsSpinnerVisible(true);
    setSpinnerLabel('Loading channel…');
    startStallWatchdog();
  }, [clearStallTimer, startStallWatchdog]);

  const handleError = useCallback((err: any) => {
    if (cancelledRef.current) return;

    const code = err?.error?.errorCode   as number | undefined;
    const msg  = err?.error?.errorString as string | undefined;
    console.error('[VideoPlayer] ExoPlayer error:', code, msg);

    clearAllTimers();

    // BEHIND_LIVE_WINDOW: seek to live edge, do NOT reconnect
    if (code === EXO_ERROR_BEHIND_LIVE_WINDOW) {
      console.log('[VideoPlayer] BEHIND_LIVE_WINDOW — seeking to live edge');
      setIsSpinnerVisible(true);
      setSpinnerLabel('Catching up to live…');
      seekToLiveEdge();
      return;
    }

    safeReport('Playback error', 'PLAYBACK_ERROR', {
      channelId:   channel.id,
      channelName: channel.name,
      streamUrl:   channel.streamUrl,
      exoCode:     code,
      exoMsg:      msg,
    });

    retryTimerRef.current = setTimeout(() => {
      if (!cancelledRef.current) reconnect();
    }, RETRY_INTERVAL_MS);
  }, [clearAllTimers, seekToLiveEdge, reconnect, channel]);

  const handleProgress = useCallback((_: OnProgressData) => {}, []);

  // ── Render ────────────────────────────────────────────────────────────────

  // Build source headers: merge stream-level httpHeaders on top of defaults.
  const sourceHeaders: Record<string, string> = {
    'User-Agent': stream?.userAgent ?? 'VLC/3.0.18 LibVLC/3.0.18',
    'Accept':     ACCEPT_HEADER,
    'Connection': 'keep-alive',
    ...(stream?.httpHeaders ?? {}),
  };

  // Build DRM prop for react-native-video (null when stream is not encrypted).
  const drmProp = stream?.drm ? toDRMTypeProp(stream.drm) : undefined;

  return (
    <View style={styles.container}>

      {stream && (
        <View style={styles.videoWrapper} pointerEvents="none">
          <Video
            ref={videoRef}
            source={{
              uri:  stream.url,
              type: stream.type,
              headers: sourceHeaders,
            }}
            style={styles.video}
            resizeMode="contain"
            bufferConfig={BUFFER_CONFIG}
            paused={!appActive}
            repeat={false}
            playInBackground={false}
            playWhenInactive={false}
            ignoreSilentSwitch="ignore"
            minLoadRetryCount={5}
            reportBandwidth={false}
            onLoadStart={handleLoadStart}
            onLoad={handleLoad}
            onError={handleError}
            onBuffer={handleBuffer}
            onProgress={handleProgress}
            focusable={false}
            // ── DRM — only rendered when the stream requires decryption ──────
            {...(drmProp ? { drm: drmProp } : {})}
            {...(Platform.isTV ? { isTVSelectable: false } : {})}
          />
        </View>
      )}

      {isSpinnerVisible && (
        <View style={styles.overlay}>
          <ActivityIndicator size="large" color="#3b82f6" />
          <Text style={styles.overlayLabel}>{spinnerLabel}</Text>
          <Text style={styles.overlayChannel}>{channel.name}</Text>

          {/* Show DRM badge so users know encryption is active */}
          {stream?.drm && (
            <View style={styles.drmBadge}>
              <Text style={styles.drmBadgeText}>
                🔐 {stream.drm.type.toUpperCase()}
              </Text>
            </View>
          )}

          {spinnerLabel.startsWith('Reconnecting') && (
            <Text style={styles.overlayHint}>
              Retrying every {RETRY_INTERVAL_MS / 1000}s — switch channel to stop
            </Text>
          )}
        </View>
      )}

    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#000' },
  videoWrapper: { flex: 1 },
  video:        { flex: 1 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.85)',
  },
  overlayLabel:   { color: '#fff',     marginTop: 14, fontSize: 16, fontWeight: '600' },
  overlayChannel: { color: '#9ca3af', marginTop: 6,  fontSize: 13 },
  overlayHint:    { color: '#6b7280', marginTop: 8,  fontSize: 11, textAlign: 'center', paddingHorizontal: 24 },
  drmBadge: {
    marginTop: 10,
    backgroundColor: 'rgba(59,130,246,0.25)',
    borderWidth: 1,
    borderColor: '#3b82f6',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  drmBadgeText: {
    color: '#93c5fd',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
});

export default VideoPlayer;