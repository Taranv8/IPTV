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
import {
  StreamResolver,
  ResolvedStream,
  DRMConfig,
  MAX_RETRIES_PER_SOURCE,
} from '../../services/stream/StreamResolver';
import { VideoErrorBoundary } from './VideoErrorBoundary';

// ─── Constants ────────────────────────────────────────────────────────────────

const STALL_TIMEOUT_MS  = 8_000;
const RETRY_INTERVAL_MS = 5_000;

const EXO_ERROR_BEHIND_LIVE_WINDOW         = 21002;
const EXO_ERROR_BAD_HTTP_STATUS            = 22004;
const EXO_ERROR_PARSING_MANIFEST_MALFORMED = 23002;

// Errors that mean the current source is permanently broken — skip immediately.
const FATAL_SOURCE_ERROR_CODES = new Set([
  EXO_ERROR_PARSING_MANIFEST_MALFORMED,
  EXO_ERROR_BAD_HTTP_STATUS,
]);

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

function toDRMTypeProp(config: DRMConfig): {
  type: DRMType;
  clearkeys?: Record<string, string>;
  licenseServer?: string;
  headers?: Record<string, string>;
} {
  switch (config.type) {
    case 'clearkey':
      return { type: DRMType.CLEARKEY, clearkeys: config.clearkeys };
    case 'widevine':
      return { type: DRMType.WIDEVINE, licenseServer: config.licenseServer, headers: config.headers };
    case 'playready':
      return { type: DRMType.PLAYREADY, licenseServer: config.licenseServer, headers: config.headers };
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

// ─── Inner player (wrapped by ErrorBoundary below) ────────────────────────────

const VideoPlayerInner: React.FC<Props> = ({ channel }) => {

  const [stream,           setStream]           = useState<ResolvedStream | null>(null);
  const [isSpinnerVisible, setIsSpinnerVisible] = useState(true);
  const [spinnerLabel,     setSpinnerLabel]     = useState('Resolving stream\u2026');

  const streamIndexRef   = useRef(0);
  const videoRef         = useRef<any>(null);
  const cancelledRef     = useRef(false);
  const stallTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef    = useRef(0);

  // Stable refs so callbacks never go stale without needing each other
  // in their dependency arrays (prevents infinite re-creation chains).
  const reconnectRef     = useRef<() => Promise<void>>(async () => {});
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
    console.log('[VideoPlayer] \uD83D\uDD01 Seeking to live edge');
    try {
      videoRef.current.seek(Number.MAX_SAFE_INTEGER);
    } catch (e) {
      console.warn('[VideoPlayer] seekToLiveEdge failed \u2014 scheduling reconnect:', e);
      scheduleRetryRef.current();
    }
  }, []); // accesses only mutable refs, no hook deps needed

  // ── Source picker ─────────────────────────────────────────────────────────

  const pickNextSource = useCallback(() => {
    const urls = channel.streamUrls ?? [];
    if (urls.length === 0) return null;
    const idx = Math.floor(retryCountRef.current / MAX_RETRIES_PER_SOURCE) % urls.length;
    if (idx !== streamIndexRef.current) {
      console.log(`[VideoPlayer] \uD83D\uDD00 Switching to source #${idx} ("${urls[idx]?.source ?? 'unknown'}")`);
      streamIndexRef.current = idx;
    }
    return urls[idx] ?? null;
  }, [channel.streamUrls]);

  // ── Full reconnect ────────────────────────────────────────────────────────

  const reconnect = useCallback(async () => {
    if (cancelledRef.current) return;

    retryCountRef.current += 1;
    const attempt = retryCountRef.current;
    console.log(`[VideoPlayer] \uD83D\uDD04 Reconnect #${attempt} \u2014 "${channel.name}"`);

    setIsSpinnerVisible(true);
    setSpinnerLabel(`Reconnecting\u2026 (attempt ${attempt})`);

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
      console.warn(`[VideoPlayer] \u274C Reconnect #${attempt} threw:`, e?.message ?? e);
    }

    if (cancelledRef.current) return;

    if (resolved) {
      console.log(`[VideoPlayer] \u2705 Reconnect #${attempt} \u2192 ${resolved.type}:`, resolved.url);
      setStream({ ...resolved });
      setIsSpinnerVisible(true);
      setSpinnerLabel('Loading channel\u2026');
    } else {
      scheduleRetryRef.current();
    }
  }, [channel.name, pickNextSource]);

  useEffect(() => { reconnectRef.current = reconnect; }, [reconnect]);

  const scheduleNextRetry = useCallback(() => {
    if (cancelledRef.current) return;
    clearRetryTimer();
    console.log(`[VideoPlayer] \u23F1 Retry in ${RETRY_INTERVAL_MS / 1000}s`);
    retryTimerRef.current = setTimeout(() => {
      if (!cancelledRef.current) reconnectRef.current();
    }, RETRY_INTERVAL_MS);
  }, [clearRetryTimer]);

  useEffect(() => { scheduleRetryRef.current = scheduleNextRetry; }, [scheduleNextRetry]);

  // ── Stall watchdog ────────────────────────────────────────────────────────

  const startStallWatchdog = useCallback(() => {
    clearStallTimer();
    stallTimerRef.current = setTimeout(() => {
      if (cancelledRef.current) return;
      console.warn(`[VideoPlayer] \u26A0\uFE0F Stalled ${STALL_TIMEOUT_MS / 1000}s \u2014 reconnecting`);
      reconnectRef.current();
    }, STALL_TIMEOUT_MS);
  }, [clearStallTimer]);

  // ── Initial resolution ────────────────────────────────────────────────────

  useEffect(() => {
    cancelledRef.current = true;
    clearAllTimers();

    cancelledRef.current   = false;
    retryCountRef.current  = 0;
    streamIndexRef.current = 0;

    setStream(null);
    setIsSpinnerVisible(true);
    setSpinnerLabel('Resolving stream\u2026');

    console.log(`[VideoPlayer] \u2500\u2500 Channel: "${channel.name}" \u2192 ${channel.streamUrl}`);

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
        console.log(`[VideoPlayer] Initial \u2192 ${resolved.type}:`, resolved.url);
        if (resolved.drm) console.log('[VideoPlayer] DRM:', resolved.drm.type);
        setStream(resolved);
        setSpinnerLabel('Loading channel\u2026');
      } else {
        reconnectRef.current();
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
    console.log(`[VideoPlayer] \u25B6\uFE0F  Playing "${channel.name}"`);
  }, [clearAllTimers, channel.name]);

  const handleBuffer = useCallback(({ isBuffering }: { isBuffering: boolean }) => {
    if (cancelledRef.current) return;
    if (!isBuffering) {
      clearStallTimer();
      setIsSpinnerVisible(false);
      return;
    }
    setIsSpinnerVisible(true);
    setSpinnerLabel('Loading channel\u2026');
    startStallWatchdog();
  }, [clearStallTimer, startStallWatchdog]);

  const handleError = useCallback((err: any) => {
    if (cancelledRef.current) return;

    const code = err?.error?.errorCode   as number | undefined;
    const msg  = err?.error?.errorString as string | undefined;
    console.error('[VideoPlayer] ExoPlayer error:', code, msg);

    clearAllTimers();

    if (code === EXO_ERROR_BEHIND_LIVE_WINDOW) {
      setIsSpinnerVisible(true);
      setSpinnerLabel('Catching up to live\u2026');
      seekToLiveEdge();
      return;
    }

    // Fatal source error: skip immediately to next source without waiting.
    if (code !== undefined && FATAL_SOURCE_ERROR_CODES.has(code)) {
      const currentIdx = streamIndexRef.current;
      retryCountRef.current = (currentIdx + 1) * MAX_RETRIES_PER_SOURCE;
      console.warn(`[VideoPlayer] Fatal error ${code} on source #${currentIdx} \u2014 skipping to next`);
      setIsSpinnerVisible(true);
      setSpinnerLabel('Trying next source\u2026');
      reconnectRef.current();
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
      if (!cancelledRef.current) reconnectRef.current();
    }, RETRY_INTERVAL_MS);
  }, [clearAllTimers, seekToLiveEdge, channel]);

  const handleProgress = useCallback((_: OnProgressData) => {}, []);

  // ── Build source props ────────────────────────────────────────────────────

  const cookie = stream?.httpHeaders?.['Cookie'];

  const sourceHeaders: Record<string, string> = {
    'User-Agent': (stream?.userAgent && !stream.userAgent.startsWith('@'))
      ? stream.userAgent
      : 'Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    'Accept':     ACCEPT_HEADER,
    'Connection': 'keep-alive',
    // Spread httpHeaders but always drop any user-agent variant (handled above).
    // StreamResolver strips it too, but we guard here as a second layer.
    ...Object.fromEntries(
      Object.entries(stream?.httpHeaders ?? {}).filter(([k]) => k.toLowerCase() !== 'user-agent')
    ),
    ...(cookie ? { 'Cookie': cookie } : {}),
  };

  // Build DRM prop safely — a bad config must not crash the native layer.
  let drmProp: ReturnType<typeof toDRMTypeProp> | undefined;
  if (stream?.drm) {
    try {
      drmProp = toDRMTypeProp(stream.drm);
    } catch (e) {
      console.warn('[VideoPlayer] Failed to build DRM prop \u2014 playing without DRM:', e);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>

      {stream && (
        <View style={styles.videoWrapper} pointerEvents="none">
          {/*
            key={stream.url} — THE PRIMARY CRASH FIX.

            Without this, React keeps the same <Video> instance when `stream`
            state updates (e.g. switching from the PHP source to the JioTV
            DRM source). ExoPlayer's internal DRM session is bound to the
            original MediaItem; swapping source + drm props in-place on an
            already-initialised player causes a native crash with no JS trace,
            which closes the whole app.

            A changed `key` forces React to fully UNMOUNT the old <Video> and
            MOUNT a fresh one, giving ExoPlayer a clean slate each time the
            URL changes. The spinner overlay hides the brief visual gap.
          */}
          <Video
            key={stream.url}
            ref={videoRef}
            source={{
              uri:     stream.url,
              type:    stream.type,
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

          {stream?.drm && (
            <View style={styles.drmBadge}>
              <Text style={styles.drmBadgeText}>\uD83D\uDD10 {stream.drm.type.toUpperCase()}</Text>
            </View>
          )}

          {spinnerLabel.startsWith('Reconnecting') && (
            <Text style={styles.overlayHint}>
              Retrying every {RETRY_INTERVAL_MS / 1000}s \u2014 switch channel to stop
            </Text>
          )}
        </View>
      )}
    </View>
  );
};

// ─── Public export — always wrapped in an ErrorBoundary ───────────────────────
//
// Catches any remaining native exceptions that bubble through the React tree
// (e.g. DRM init failures on unsupported devices) and shows a recoverable
// error UI instead of closing the entire app.

const VideoPlayer: React.FC<Props> = ({ channel }) => {
  // Incrementing this key remounts the entire boundary + player subtree,
  // which is exactly what the "Try Again" button in the error UI needs.
  const [boundaryKey, setBoundaryKey] = useState(0);

  return (
    <VideoErrorBoundary
      key={boundaryKey}
      channelName={channel.name}
      onRetry={() => setBoundaryKey(k => k + 1)}
    >
      <VideoPlayerInner channel={channel} />
    </VideoErrorBoundary>
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
  overlayLabel:   { color: '#fff',    marginTop: 14, fontSize: 16, fontWeight: '600' },
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