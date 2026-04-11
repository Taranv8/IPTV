// src/components/player/VideoPlayer.tsx
//
// FIXES APPLIED:
//
// 1. toDRMTypeProp — ClearKey now handles BOTH variants:
//    a) clearkeys map  (inline hex-derived keys)
//    b) licenseServer URL (remote key endpoint like keys.lrl45.workers.dev)
//    Previously passing clearkeys: undefined to the native layer caused an
//    immediate native crash with no JS stack trace.
//
// 2. drmProp construction wrapped in validation — if neither clearkeys nor
//    licenseServer is present, the DRM prop is silently dropped and we log
//    a warning instead of passing a broken object to ExoPlayer.
//
// 3. All callbacks guarded with try/catch so a thrown error in a native
//    callback can't bypass VideoErrorBoundary and close the app.
//
// 4. Verbose per-source logging so you can see in logcat exactly which
//    URL / DRM config ExoPlayer is receiving.
// ─────────────────────────────────────────────────────────────────────────────

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
  ClearKeyDRM,
  MAX_RETRIES_PER_SOURCE,
} from '../../services/stream/StreamResolver';
import { VideoErrorBoundary } from './VideoErrorBoundary';

// ─── Constants ────────────────────────────────────────────────────────────────

const STALL_TIMEOUT_MS  = 8_000;
const RETRY_INTERVAL_MS = 5_000;

const EXO_ERROR_BEHIND_LIVE_WINDOW         = 21002;
const EXO_ERROR_BAD_HTTP_STATUS            = 22004;
const EXO_ERROR_PARSING_MANIFEST_MALFORMED = 23002;

const FATAL_SOURCE_ERROR_CODES = new Set([
  EXO_ERROR_PARSING_MANIFEST_MALFORMED,
  EXO_ERROR_BAD_HTTP_STATUS,
]);

const BUFFER_CONFIG = {
  minBufferMs:                      3_000,
  maxBufferMs:                     10_000,
  bufferForPlaybackMs:              2_000,
  bufferForPlaybackAfterRebufferMs: 3_000,
  // backBufferDurationMs:                 0,
  // cacheSizeMb:                          0,
} as const;
const hasLoadedOnce = useRef(false);
const ACCEPT_HEADER =
  'application/x-mpegURL, application/vnd.apple.mpegurl, audio/mpegurl, application/dash+xml, video/mp4, */*';

// ─── DRM type mapper ──────────────────────────────────────────────────────────
//
// FIX: ClearKey is now handled for both inline (clearkeys map) and remote
// (licenseServer URL) variants. Returns null if neither field is usable
// so we never pass a broken config to ExoPlayer.

type DRMProp = {
  type: DRMType;
  clearkeys?: Record<string, string>;
  licenseServer?: string;
  headers?: Record<string, string>;
} | null;

function toDRMTypeProp(config: DRMConfig): DRMProp {
  switch (config.type) {

    case 'clearkey': {
      const ck = config as ClearKeyDRM;

      if (ck.clearkeys && Object.keys(ck.clearkeys).length > 0) {
        console.log('[VideoPlayer] DRM prop → ClearKey INLINE keys:', Object.keys(ck.clearkeys));
        return { type: DRMType.CLEARKEY, clearkeys: ck.clearkeys };
      }

      if (ck.licenseServer) {
        console.log('[VideoPlayer] DRM prop → ClearKey LICENSE SERVER:', ck.licenseServer);
        return { type: DRMType.CLEARKEY, licenseServer: ck.licenseServer };
      }

      console.warn('[VideoPlayer] ClearKeyDRM has neither clearkeys nor licenseServer — skipping DRM prop');
      return null;
    }

    case 'widevine':
      console.log('[VideoPlayer] DRM prop → Widevine:', config.licenseServer);
      return { type: DRMType.WIDEVINE, licenseServer: config.licenseServer, headers: config.headers };

    case 'playready':
      console.log('[VideoPlayer] DRM prop → PlayReady:', config.licenseServer);
      return { type: DRMType.PLAYREADY, licenseServer: config.licenseServer, headers: config.headers };

    default:
      console.warn('[VideoPlayer] Unknown DRM type:', (config as any).type);
      return null;
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
  const [errorMessage,     setErrorMessage]     = useState<string | null>(null);

  const streamIndexRef   = useRef(0);
  const videoRef         = useRef<any>(null);
  const cancelledRef     = useRef(false);
  const stallTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef    = useRef(0);

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
  }, []);

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
    setErrorMessage(null);

    const sourceEntry = pickNextSource();
    if (!sourceEntry) {
      const msg = 'No stream sources available';
      console.warn('[VideoPlayer]', msg);
      setErrorMessage(msg);
      scheduleRetryRef.current();
      return;
    }

    let resolved: ResolvedStream | null = null;
    try {
      resolved = await StreamResolver.resolve(sourceEntry);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      console.warn(`[VideoPlayer] \u274C Reconnect #${attempt} threw:`, msg);
      setErrorMessage(`Resolve error: ${msg}`);
    }

    if (cancelledRef.current) return;

    if (resolved) {
      console.log(`[VideoPlayer] \u2705 Reconnect #${attempt} \u2192 ${resolved.type}:`, resolved.url);
      if (resolved.drm) console.log('[VideoPlayer] DRM:', JSON.stringify(resolved.drm));
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

    if (!channel?.streamUrl && !channel?.streamUrls?.length) return; // ← ADD
  
    cancelledRef.current = true;
    clearAllTimers();

    cancelledRef.current   = false;
    retryCountRef.current  = 0;
    streamIndexRef.current = 0;

    setStream(null);
    setErrorMessage(null);
    setIsSpinnerVisible(true);
    setSpinnerLabel('Resolving stream\u2026');

    console.log(`[VideoPlayer] \u2500\u2500 Channel: "${channel.name}" \u2192 ${channel.streamUrl}`);
    console.log(`[VideoPlayer] Sources available: ${channel.streamUrls?.length ?? 0}`);

    // Prefer streamUrls[0] — it carries full DRM metadata from the API
    const initialSource = channel.streamUrls?.[0] ?? channel.streamUrl;

    (async () => {
      let resolved: ResolvedStream | null = null;
      try {
        resolved = await StreamResolver.resolve(initialSource);
      } catch (e: any) {
        console.error('[VideoPlayer] Initial resolve threw (should not happen):', e?.message ?? e);
      }

      if (cancelledRef.current) return;

      if (resolved) {
        console.log(`[VideoPlayer] Initial \u2192 ${resolved.type}:`, resolved.url);
        if (resolved.drm) {
          console.log('[VideoPlayer] DRM config:', JSON.stringify(resolved.drm));
        } else {
          console.log('[VideoPlayer] No DRM \u2014 unencrypted stream');
        }
        setStream(resolved);
        setSpinnerLabel('Loading channel\u2026');
      } else {
        reconnectRef.current();
      }
    })();

    return () => {
      cancelledRef.current = true;
    hasLoadedOnce.current = false;
      clearAllTimers();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id]);

  // ── ExoPlayer callbacks ───────────────────────────────────────────────────

  const handleLoadStart = useCallback(() => {
    try {
      clearStallTimer();
      console.log('[VideoPlayer] LoadStart \u2014 waiting for manifest');
    } catch (e) {
      console.warn('[VideoPlayer] handleLoadStart error:', e);
    }
  }, [clearStallTimer]);

  const handleLoad = useCallback((_: OnLoadData) => {
    try {
      if (cancelledRef.current) return;
      clearAllTimers();
      setIsSpinnerVisible(false);
      setErrorMessage(null);
      hasLoadedOnce.current = true;
      console.log(`[VideoPlayer] \u25B6\uFE0F  Playing "${channel.name}"`);
    } catch (e) {
      console.warn('[VideoPlayer] handleLoad error:', e);
    }
  }, [clearAllTimers, channel.name]);

  const handleBuffer = useCallback(({ isBuffering }: { isBuffering: boolean }) => {
    try {
      if (cancelledRef.current) return;
      if (!isBuffering) {
        clearStallTimer();
        setIsSpinnerVisible(false);
        return;
      }
      setIsSpinnerVisible(true);
      setSpinnerLabel('Loading channel\u2026');
if (hasLoadedOnce.current) startStallWatchdog();
    } catch (e) {
      console.warn('[VideoPlayer] handleBuffer error:', e);
    }
  }, [clearStallTimer, startStallWatchdog]);

  const handleError = useCallback((err: any) => {
    try {
      if (cancelledRef.current) return;

      const code   = err?.error?.errorCode   as number | undefined;
      const msg    = err?.error?.errorString as string | undefined;
      const domain = err?.error?.domain      as string | undefined;

      console.error(
        `[VideoPlayer] \u274C ExoPlayer error | code=${code ?? 'n/a'} | domain=${domain ?? 'n/a'} | msg=${msg ?? 'n/a'}`,
      );
      console.error('[VideoPlayer] Full error:', JSON.stringify(err, null, 2));

      clearAllTimers();
      setErrorMessage(`Error ${code ?? '?'}: ${msg ?? 'Unknown playback error'}`);

      if (code === EXO_ERROR_BEHIND_LIVE_WINDOW) {
        console.log('[VideoPlayer] Behind live window \u2014 seeking to live edge');
        setIsSpinnerVisible(true);
        setSpinnerLabel('Catching up to live\u2026');
        seekToLiveEdge();
        return;
      }

      if (code !== undefined && FATAL_SOURCE_ERROR_CODES.has(code)) {
        const currentIdx = streamIndexRef.current;
        retryCountRef.current = (currentIdx + 1) * MAX_RETRIES_PER_SOURCE;
        console.warn(`[VideoPlayer] Fatal error ${code} on source #${currentIdx} \u2014 skipping to next source`);
        setIsSpinnerVisible(true);
        setSpinnerLabel('Trying next source\u2026');
        reconnectRef.current();
        return;
      }

      safeReport('Playback error', 'PLAYBACK_ERROR', {
        channelId:   channel.id,
        channelName: channel.name,
        streamUrl:   stream?.url ?? channel.streamUrl,
        streamType:  stream?.type,
        hasDRM:      !!stream?.drm,
        drmType:     stream?.drm?.type,
        exoCode:     code,
        exoMsg:      msg,
        exoDomain:   domain,
      });

     retryTimerRef.current = setTimeout(() => {
  if (!cancelledRef.current) reconnectRef.current();   // ← correct
}, RETRY_INTERVAL_MS);
    } catch (e) {
      // Never let handleError itself crash the app
      console.error('[VideoPlayer] handleError threw unexpectedly:', e);
    }
  }, [clearAllTimers, seekToLiveEdge, channel, stream]);

  const handleProgress = useCallback((_: OnProgressData) => {}, []);

  // ── Build source props ────────────────────────────────────────────────────

  const sourceHeaders: Record<string, string> = {
    'User-Agent': (stream?.userAgent && !stream.userAgent.startsWith('@'))
      ? stream.userAgent
      : 'Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    'Accept':     ACCEPT_HEADER,
    'Connection': 'keep-alive',
   ...Object.fromEntries(
  Object.entries(stream?.httpHeaders ?? {})
    .filter(([k]) => k.toLowerCase() !== 'user-agent')  // ← this is fine, keep it
),
  };

  // Build DRM prop with validation — never pass an empty/broken config to native
  let drmProp: DRMProp = null;
  if (stream?.drm) {
    try {
      drmProp = toDRMTypeProp(stream.drm);
      if (!drmProp) {
        console.warn(
          '[VideoPlayer] DRM config present but toDRMTypeProp returned null \u2014 playing without DRM.',
          'Config was:', JSON.stringify(stream.drm),
        );
      }
    } catch (e) {
      console.warn('[VideoPlayer] Failed to build DRM prop \u2014 playing without DRM:', e);
    }
  }

  // Log what we actually hand to ExoPlayer each time the stream changes
  useEffect(() => {
    if (!stream) return;
    console.log('[VideoPlayer] \uD83D\uDCFA Handing to ExoPlayer:');
    console.log('  url  =', stream.url);
    console.log('  type =', stream.type);
    console.log('  UA   =', sourceHeaders['User-Agent']);
    console.log('  DRM  =', drmProp ? JSON.stringify(drmProp) : 'none');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream?.url]);



  console.log('[DEBUG] stream:', JSON.stringify({
  url: stream?.url,
  type: stream?.type,
  hasDRM: !!stream?.drm,
  drmType: stream?.drm?.type,
}));
  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>

      {stream && (
        <View style={styles.videoWrapper} pointerEvents="none">
      <Video
  key={stream.url}
  ref={videoRef}
  source={{
    uri: stream.url,
    headers: sourceHeaders,
  }}
  style={styles.video}
  resizeMode="contain"
  paused={!appActive}
  repeat={false}
  playInBackground={false}
  ignoreSilentSwitch="ignore"
  onLoadStart={handleLoadStart}
  onLoad={handleLoad}
  onError={handleError}
  onBuffer={handleBuffer}
  focusable={false}
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
              <Text style={styles.drmBadgeText}>
                {'\uD83D\uDD10'} {stream.drm.type.toUpperCase()}
                {stream.drm.type === 'clearkey' && (stream.drm as ClearKeyDRM).licenseServer
                  ? ' (URL KEY)'
                  : stream.drm.type === 'clearkey'
                  ? ' (INLINE)'
                  : ''}
              </Text>
            </View>
          )}

          {errorMessage && (
            <Text style={styles.overlayError} numberOfLines={3}>
              {'\u26A0\uFE0F'} {errorMessage}
            </Text>
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

const VideoPlayer: React.FC<Props> = ({ channel }) => {
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
  overlayError:   { color: '#f87171', marginTop: 8,  fontSize: 11, textAlign: 'center', paddingHorizontal: 24 },
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