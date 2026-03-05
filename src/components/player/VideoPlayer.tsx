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
import Video, { OnLoadData, OnProgressData } from 'react-native-video';
import { Channel } from '../../types/channel';
import { StreamResolver, ResolvedStream } from '../../services/stream/StreamResolver';

// ─── Constants ────────────────────────────────────────────────────────────────

const STALL_TIMEOUT_MS  = 8_000;   // ms stuck buffering before forcing reconnect
const RETRY_INTERVAL_MS = 5_000;   // ms between reconnect attempts

// ExoPlayer error codes we handle explicitly
const EXO_ERROR_BEHIND_LIVE_WINDOW = 21002; // fell behind live HLS window → seek to edge
const EXO_ERROR_BAD_HTTP_STATUS    = 22004; // server rejected request → reconnect

// ─── Buffer config ────────────────────────────────────────────────────────────
//
// For live IPTV streams the most important knobs are:
//   backBufferDurationMs = 0   → discard played segments from RAM immediately
//   maxBufferMs          = 10s → don't buffer too far ahead on live streams
//                                (buffering too much ahead is what causes
//                                 BEHIND_LIVE_WINDOW — ExoPlayer gets so far
//                                 ahead that its position expires)

const BUFFER_CONFIG = {
  minBufferMs:                      3_000,   // reduced from 5s — reconnect faster
  maxBufferMs:                     10_000,   // reduced from 15s — key fix for live streams
  bufferForPlaybackMs:              2_000,   // start playing after 2s
  bufferForPlaybackAfterRebufferMs: 3_000,   // resume after rebuffer with 3s
  backBufferDurationMs:                 0,   // discard played segments immediately
  cacheSizeMb:                          0,   // no disk cache
} as const;

const ACCEPT_HEADER =
  'application/x-mpegURL, application/vnd.apple.mpegurl, audio/mpegurl, application/dash+xml, video/mp4, */*';

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
  //
  // Called when ExoPlayer throws ERROR_CODE_BEHIND_LIVE_WINDOW (21002).
  //
  // This error means the player's current position is older than the oldest
  // segment still available in the live HLS playlist. The playlist has moved
  // forward but the player hasn't.
  //
  // The correct fix is to seek to the live edge (the very end of the known
  // stream), NOT to reconnect. Reconnecting restarts ExoPlayer from scratch
  // which takes 2-3 seconds, falls behind again, and loops forever.
  //
  // react-native-video: seek(0) on a live stream seeks to the live edge
  // because position 0 in a live stream means "the beginning of the live
  // window" which is the most recent content, not the beginning of time.
  // Alternatively seeking to a very large number forces ExoPlayer to the
  // furthest available position.

  const seekToLiveEdge = useCallback(() => {
    if (!videoRef.current || cancelledRef.current) return;
    console.log('[VideoPlayer] 🔁 Seeking to live edge (BEHIND_LIVE_WINDOW recovery)');
    try {
      // Seek to a very large number — ExoPlayer clamps it to the live edge
      videoRef.current.seek(Number.MAX_SAFE_INTEGER);
    } catch (e) {
      console.warn('[VideoPlayer] seekToLiveEdge failed, falling back to reconnect:', e);
      // If seek throws (older RN video versions), fall back to full reconnect
      reconnect();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Full reconnect ────────────────────────────────────────────────────────
  //
  // Used for genuine network/server failures (22004, generic errors).
  // NOT used for BEHIND_LIVE_WINDOW — use seekToLiveEdge() for that.

  const reconnect = useCallback(async () => {
    if (cancelledRef.current) return;

    retryCountRef.current += 1;
    const attempt = retryCountRef.current;
    console.log(`[VideoPlayer] 🔄 Reconnect #${attempt} — "${channel.name}"`);

    setIsSpinnerVisible(true);
    setSpinnerLabel(`Reconnecting… (attempt ${attempt})`);

    let resolved: ResolvedStream | null = null;
    try {
      resolved = await StreamResolver.resolve(channel.streamUrl);
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
  }, [channel.name, channel.streamUrl]);

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

    setStream(null);
    setIsSpinnerVisible(true);
    setSpinnerLabel('Resolving stream…');

    console.log(`[VideoPlayer] ── Channel: "${channel.name}" → ${channel.streamUrl}`);

    (async () => {
      let resolved: ResolvedStream | null = null;
      try {
        resolved = await StreamResolver.resolve(channel.streamUrl);
      } catch (e: any) {
        console.error('[VideoPlayer] Initial resolve threw:', e?.message ?? e);
      }

      if (cancelledRef.current) return;

      if (resolved) {
        console.log(`[VideoPlayer] Initial → ${resolved.type}:`, resolved.url);
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

  /**
   * ExoPlayer error handler.
   *
   * IMPORTANT: Different errors need different recovery strategies.
   *
   * 21002 ERROR_CODE_BEHIND_LIVE_WINDOW
   *   → The player fell behind the live HLS window (segments expired).
   *   → Fix: seek to live edge. Fast, no reconnect needed.
   *   → Do NOT reconnect — reconnect restarts ExoPlayer, causes 2-3s black
   *     screen, and the player immediately falls behind again, creating a loop.
   *
   * 22004 ERROR_CODE_IO_BAD_HTTP_STATUS
   *   → Server rejected the request (403, 500, etc.)
   *   → Fix: full reconnect after RETRY_INTERVAL_MS.
   *
   * Everything else
   *   → Full reconnect.
   */
  const handleError = useCallback((err: any) => {
    if (cancelledRef.current) return;

    const code = err?.error?.errorCode   as number | undefined;
    const msg  = err?.error?.errorString as string | undefined;
    console.error('[VideoPlayer] ExoPlayer error:', code, msg);

    clearAllTimers();

    // ── BEHIND_LIVE_WINDOW: seek to edge, do NOT reconnect ───────────────────
    if (code === EXO_ERROR_BEHIND_LIVE_WINDOW) {
      console.log('[VideoPlayer] BEHIND_LIVE_WINDOW — seeking to live edge');
      setIsSpinnerVisible(true);
      setSpinnerLabel('Catching up to live…');
      seekToLiveEdge();
      return;
    }

    // ── All other errors: full reconnect ──────────────────────────────────────
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

  return (
    <View style={styles.container}>

      {stream && (
        <View style={styles.videoWrapper} pointerEvents="none">
          <Video
            ref={videoRef}
            source={{
              uri:  stream.url,
              type: stream.type,
              headers: {
                'User-Agent': stream.userAgent,
                'Accept':     ACCEPT_HEADER,
                'Connection': 'keep-alive',
              },
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
            {...(Platform.isTV ? { isTVSelectable: false } : {})}
          />
        </View>
      )}

      {isSpinnerVisible && (
        <View style={styles.overlay}>
          <ActivityIndicator size="large" color="#3b82f6" />
          <Text style={styles.overlayLabel}>{spinnerLabel}</Text>
          <Text style={styles.overlayChannel}>{channel.name}</Text>
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
});

export default VideoPlayer;