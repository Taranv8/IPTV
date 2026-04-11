// src/components/player/VideoPlayer.tsx
//
// KEY IMPROVEMENTS vs previous version:
//
// 1. IMMEDIATE SOURCE SWITCHING
//    Previous: retry same source 3× before switching (MAX_RETRIES_PER_SOURCE=3)
//    Now:      switch to next source on the FIRST failure, every time.
//    This matches TiViMate behaviour and is why it "just works" there.
//
// 2. BUFFER REDUCED TO 15s MAX (was 30s)
//    PHP/IPTV wrappers (bdixgen.site) generate token-signed .ts segment URLs
//    that typically expire in 20-30s. Buffering 30s ahead means ExoPlayer
//    fetches a segment, waits, then tries to play it after the token expired
//    → 403 → rebuffer. 15s keeps well within the token window.
//
// 3. SOURCE ROUND-ROBIN WITH FULL-CYCLE DETECTION
//    After all sources have been tried once, we wait INTER_CYCLE_DELAY_MS
//    before starting again from source 0. Prevents hammering a dead server.
//
// 4. STALL TIMEOUT RAISED TO 15s
//    10s segments on slow connections legitimately take >12s to download.
//    15s gives ExoPlayer enough time to fetch without triggering a false
//    reconnect that interrupts playback unnecessarily.
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
} from '../../services/stream/StreamResolver';
import { VideoErrorBoundary } from './VideoErrorBoundary';

// ─── Timing constants ─────────────────────────────────────────────────────────

// Only fire stall watchdog after first successful load to avoid premature
// reconnects during the initial buffer fill (can take >12s on slow connections).
const STALL_TIMEOUT_MS     = 15_000;

// After one failed attempt, wait this long before retrying the same source.
const RETRY_DELAY_MS       =  5_000;

// After ALL sources have been tried once with no success, pause this long
// before starting the round-robin again. Prevents hammering a dead server.
const INTER_CYCLE_DELAY_MS = 10_000;

// ─── ExoPlayer error codes ────────────────────────────────────────────────────

const EXO_BEHIND_LIVE_WINDOW    = 21002; // seek to live edge, don't reconnect
const EXO_BAD_HTTP_STATUS       = 22004; // 4xx/5xx from CDN → skip source now
const EXO_MANIFEST_MALFORMED    = 23002; // broken playlist → skip source now
const EXO_CONTAINER_UNSUPPORTED = 23003; // wrong extractor → skip source now

// These mean the current source URL is permanently broken for this session.
// Skip to the next source immediately instead of waiting RETRY_DELAY_MS.
const SKIP_NOW_CODES = new Set([
  EXO_BAD_HTTP_STATUS,
  EXO_MANIFEST_MALFORMED,
  EXO_CONTAINER_UNSUPPORTED,
]);

// ─── Buffer config ────────────────────────────────────────────────────────────
//
//  maxBufferMs: 15 000  (was 30 000)
//    PHP/IPTV token-signed segments expire in ~20-30s. Keeping the lookahead
//    at 15s ensures ExoPlayer never fetches a segment so far in advance that
//    the token is stale by playback time.
//
//  minBufferMs: 3 000
//    ExoPlayer starts fetching more data when buffer drops below 3s. Lower
//    than maxBufferMs so the player isn't constantly chasing its own tail.
//
//  bufferForPlaybackMs: 1 000
//    Start playing after just 1s — fast channel switch feel.
//
//  bufferForPlaybackAfterRebufferMs: 2 500
//    After a stall, need 2.5s before resuming. Prevents yo-yo starts.
//
//  backBufferDurationMs: 3 000
//    Keep 3s of already-played data. Prevents BEHIND_LIVE_WINDOW (21002)
//    which happens when ExoPlayer's playhead drifts slightly behind the
//    live window edge during a rebuffer cycle. ExoPlayer auto-discards
//    anything older than 3s so there is no memory leak.
//
//  cacheSizeMb: 0
//    Never write live segments to disk. They're worthless once played.

const BUFFER_CONFIG = {
  minBufferMs:                       3_000,
  maxBufferMs:                      15_000,
  bufferForPlaybackMs:               1_000,
  bufferForPlaybackAfterRebufferMs:  2_500,
  backBufferDurationMs:              3_000,
  cacheSizeMb:                           0,
} as const;

const ACCEPT_HEADER =
  'application/x-mpegURL, application/vnd.apple.mpegurl, audio/mpegurl, application/dash+xml, video/mp4, */*';

// ─── DRM mapper ───────────────────────────────────────────────────────────────

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
        return { type: DRMType.CLEARKEY, clearkeys: ck.clearkeys };
      }
      if (ck.licenseServer) {
        return { type: DRMType.CLEARKEY, licenseServer: ck.licenseServer };
      }
      console.warn('[VideoPlayer] ClearKeyDRM unusable — no clearkeys and no licenseServer');
      return null;
    }
    case 'widevine':
      return { type: DRMType.WIDEVINE, licenseServer: config.licenseServer, headers: config.headers };
    case 'playready':
      return { type: DRMType.PLAYREADY, licenseServer: config.licenseServer, headers: config.headers };
    default:
      console.warn('[VideoPlayer] Unknown DRM type:', (config as any).type);
      return null;
  }
}

// ─── ErrorReporter shim ───────────────────────────────────────────────────────

async function safeReport(msg: string, code: string, extras: Record<string, unknown>) {
  try {
    const mod = require('../../services/error/ErrorReporter');
    const r   = mod?.ErrorReporter ?? mod?.default;
    if (r && typeof r.report === 'function') await r.report(new Error(msg), code, extras);
  } catch {}
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props { channel: Channel }

// ─── Inner player ─────────────────────────────────────────────────────────────

const VideoPlayerInner: React.FC<Props> = ({ channel }) => {

  const [stream,           setStream]           = useState<ResolvedStream | null>(null);
  const [isSpinnerVisible, setIsSpinnerVisible] = useState(true);
  const [spinnerLabel,     setSpinnerLabel]     = useState('Resolving stream…');
  const [errorMessage,     setErrorMessage]     = useState<string | null>(null);

  const videoRef       = useRef<any>(null);
  const cancelledRef   = useRef(false);
  const stallTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasLoadedOnce  = useRef(false);

  // ── Source round-robin state ──────────────────────────────────────────────
  // sourceIndexRef:  which streamUrls[] entry we're currently trying
  // triedInCycleRef: how many sources have been attempted in this cycle
  //                  when it reaches total sources → full cycle → longer delay
  const sourceIndexRef   = useRef(0);
  const triedInCycleRef  = useRef(0);
  const totalSourcesRef  = useRef(0);

  const reconnectRef     = useRef<(skipNow?: boolean) => Promise<void>>(async () => {});
  const scheduleRetryRef = useRef<(skipNow?: boolean) => void>(() => {});

  // ── AppState ──────────────────────────────────────────────────────────────
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const [appActive, setAppActive] = useState(true);

  useEffect(() => {
    const sub = AppState.addEventListener('change', next => {
      const was = appStateRef.current === 'active';
      const now  = next === 'active';
      appStateRef.current = next;
      if (was !== now) setAppActive(now);
    });
    return () => sub.remove();
  }, []);

  // ── Timer helpers ─────────────────────────────────────────────────────────

  const clearStallTimer = useCallback(() => {
    if (stallTimerRef.current) { clearTimeout(stallTimerRef.current); stallTimerRef.current = null; }
  }, []);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
  }, []);

  const clearAllTimers = useCallback(() => {
    clearStallTimer();
    clearRetryTimer();
  }, [clearStallTimer, clearRetryTimer]);

  // ── Live-edge seek ────────────────────────────────────────────────────────

  const seekToLiveEdge = useCallback(() => {
    if (!videoRef.current || cancelledRef.current) return;
    console.log('[VideoPlayer] 🔁 Seeking to live edge');
    try {
      videoRef.current.seek(Number.MAX_SAFE_INTEGER);
    } catch {
      scheduleRetryRef.current();
    }
  }, []);

  // ── Source picker — IMMEDIATELY advance to next source on failure ─────────
  //
  // Key difference from previous version:
  // OLD: retry same source N times, then advance
  // NEW: advance on every call — caller decides when to call this
  //
  // Returns the next StreamUrl entry to try, or null if no sources exist.

  const advanceSource = useCallback((): { url: string; entry: any } | null => {
    const urls = channel.streamUrls ?? [];
    if (urls.length === 0) return null;

    totalSourcesRef.current = urls.length;
    triedInCycleRef.current += 1;

    // Advance index (wraps around)
    const idx = sourceIndexRef.current % urls.length;
    sourceIndexRef.current  = (idx + 1) % urls.length; // next call starts after this one

    const entry = urls[idx];
    console.log(
      `[VideoPlayer] 🔀 Source ${idx + 1}/${urls.length}: "${entry?.source ?? 'unknown'}" — ${entry?.url}`,
    );
    return { url: entry?.url, entry };
  }, [channel.streamUrls]);

  // ── Full reconnect ────────────────────────────────────────────────────────
  // skipNow=true  → switch source immediately (fatal error path)
  // skipNow=false → standard retry delay (non-fatal error path)

  const reconnect = useCallback(async (skipNow = false) => {
    if (cancelledRef.current) return;

    setIsSpinnerVisible(true);
    setErrorMessage(null);

    const next = advanceSource();

    if (!next) {
      setSpinnerLabel('No sources available');
      setErrorMessage('No stream sources configured for this channel');
      console.warn('[VideoPlayer] No stream sources for:', channel.name);
      return;
    }

    // If we've just completed a full cycle through all sources with no success,
    // wait longer before hammering the servers again.
    const allSourcesTried = triedInCycleRef.current >= totalSourcesRef.current;
    if (allSourcesTried && !skipNow) {
      console.warn(`[VideoPlayer] All ${totalSourcesRef.current} sources failed — waiting ${INTER_CYCLE_DELAY_MS / 1000}s before retry cycle`);
      setSpinnerLabel(`All sources failed — retrying in ${INTER_CYCLE_DELAY_MS / 1000}s…`);
      triedInCycleRef.current = 0; // reset cycle counter
      retryTimerRef.current = setTimeout(() => {
        if (!cancelledRef.current) reconnectRef.current();
      }, INTER_CYCLE_DELAY_MS);
      return;
    }

    setSpinnerLabel(`Trying source… (${Math.min(triedInCycleRef.current, totalSourcesRef.current)}/${totalSourcesRef.current})`);

    let resolved: ResolvedStream | null = null;
    try {
      resolved = await StreamResolver.resolve(next.entry ?? next.url);
    } catch (e: any) {
      console.warn('[VideoPlayer] ❌ Resolve threw:', e?.message ?? e);
      setErrorMessage(`Resolve error: ${e?.message ?? e}`);
    }

    if (cancelledRef.current) return;

    if (resolved) {
      console.log(`[VideoPlayer] ✅ Source resolved → ${resolved.type}: ${resolved.url}`);
      console.log('[VideoPlayer] DRM:', resolved.drm ? JSON.stringify(resolved.drm) : 'none');
      setStream({ ...resolved });
      setSpinnerLabel('Loading channel…');
    } else {
      // Resolve returned null — skip immediately to the next source
      scheduleRetryRef.current(true);
    }
  }, [channel.name, advanceSource]);

  useEffect(() => { reconnectRef.current = reconnect; }, [reconnect]);

  const scheduleRetry = useCallback((skipNow = false) => {
    if (cancelledRef.current) return;
    clearRetryTimer();
    const delay = skipNow ? 0 : RETRY_DELAY_MS;
    retryTimerRef.current = setTimeout(() => {
      if (!cancelledRef.current) reconnectRef.current(skipNow);
    }, delay);
  }, [clearRetryTimer]);

  useEffect(() => { scheduleRetryRef.current = scheduleRetry; }, [scheduleRetry]);

  // ── Stall watchdog (only armed after first successful play) ───────────────

  const startStallWatchdog = useCallback(() => {
    if (!hasLoadedOnce.current) return; // don't fire during initial buffering
    clearStallTimer();
    stallTimerRef.current = setTimeout(() => {
      if (cancelledRef.current) return;
      console.warn(`[VideoPlayer] ⚠️ Stall for ${STALL_TIMEOUT_MS / 1000}s — switching source`);
      reconnectRef.current(false);
    }, STALL_TIMEOUT_MS);
  }, [clearStallTimer]);

  // ── Initial load ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!channel?.streamUrl && !channel?.streamUrls?.length) return;

    cancelledRef.current   = true;
    clearAllTimers();

    cancelledRef.current   = false;
    hasLoadedOnce.current  = false;
    sourceIndexRef.current = 0;
    triedInCycleRef.current = 0;
    totalSourcesRef.current = channel.streamUrls?.length ?? 0;

    setStream(null);
    setErrorMessage(null);
    setIsSpinnerVisible(true);
    setSpinnerLabel('Resolving stream…');

    console.log(`[VideoPlayer] ── "${channel.name}" | ${totalSourcesRef.current} source(s)`);

    // Always start with streamUrls[0] — it has the most metadata (DRM etc.)
    const firstEntry = channel.streamUrls?.[0] ?? channel.streamUrl;

    (async () => {
      let resolved: ResolvedStream | null = null;
      try {
        resolved = await StreamResolver.resolve(firstEntry);
        sourceIndexRef.current  = 1; // next failure will try index 1
        triedInCycleRef.current = 1;
      } catch (e: any) {
        console.error('[VideoPlayer] Initial resolve error:', e?.message ?? e);
      }

      if (cancelledRef.current) return;

      if (resolved) {
        console.log(`[VideoPlayer] Initial → ${resolved.type}: ${resolved.url}`);
        console.log('[VideoPlayer] DRM:', resolved.drm ? JSON.stringify(resolved.drm) : 'none');
        setStream(resolved);
        setSpinnerLabel('Loading channel…');
      } else {
        reconnectRef.current(true); // first source failed → try next immediately
      }
    })();

    return () => {
      cancelledRef.current  = true;
      hasLoadedOnce.current = false;
      clearAllTimers();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id]);

  // ── ExoPlayer callbacks ───────────────────────────────────────────────────

  const handleLoadStart = useCallback(() => {
    try { clearStallTimer(); } catch {}
  }, [clearStallTimer]);

  const handleLoad = useCallback((_: OnLoadData) => {
    try {
      if (cancelledRef.current) return;
      clearAllTimers();
      setIsSpinnerVisible(false);
      setErrorMessage(null);
      hasLoadedOnce.current  = true;
      triedInCycleRef.current = 0; // successful play → reset failure counter
      console.log(`[VideoPlayer] ▶️ Playing "${channel.name}"`);
    } catch (e) { console.warn('[VideoPlayer] handleLoad error:', e); }
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
      setSpinnerLabel('Buffering…');
      startStallWatchdog(); // no-op until hasLoadedOnce = true
    } catch (e) { console.warn('[VideoPlayer] handleBuffer error:', e); }
  }, [clearStallTimer, startStallWatchdog]);

  const handleError = useCallback((err: any) => {
    try {
      if (cancelledRef.current) return;

      const code   = err?.error?.errorCode   as number | undefined;
      const msg    = err?.error?.errorString as string | undefined;
      const domain = err?.error?.domain      as string | undefined;

      console.error(`[VideoPlayer] ❌ ExoPlayer error | code=${code ?? 'n/a'} | ${msg ?? 'n/a'}`);

      clearAllTimers();
      setErrorMessage(`[${code ?? '?'}] ${msg ?? 'Playback error'}`);

      // ── Behind live window: seek, do NOT switch source ────────────────────
      if (code === EXO_BEHIND_LIVE_WINDOW) {
        setIsSpinnerVisible(true);
        setSpinnerLabel('Catching up to live…');
        seekToLiveEdge();
        return;
      }

      // ── Fatal source error: switch immediately ────────────────────────────
      const skipNow = code !== undefined && SKIP_NOW_CODES.has(code);
      if (skipNow) {
        console.warn(`[VideoPlayer] Fatal error ${code} — skipping to next source now`);
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

      // Always move to the NEXT source on any error.
      // skipNow=true  → immediate switch (0ms delay)
      // skipNow=false → RETRY_DELAY_MS delay before trying next source
      scheduleRetryRef.current(skipNow);

    } catch (e) { console.error('[VideoPlayer] handleError threw:', e); }
  }, [clearAllTimers, seekToLiveEdge, channel, stream]);

  const handleProgress = useCallback((_: OnProgressData) => {}, []);

  // ── Build source / DRM props ──────────────────────────────────────────────

  const sourceHeaders: Record<string, string> = {
    // Use the stream's User-Agent (set by StreamResolver from API data).
    // VLC_USER_AGENT is used when the channel has no userAgent set — this
    // matches TiViMate's default UA and is accepted by most IPTV servers.
    'User-Agent': (stream?.userAgent && !stream.userAgent.startsWith('@'))
      ? stream.userAgent
      : 'VLC/3.0.18 LibVLC/3.0.18',
    'Accept':     ACCEPT_HEADER,
    'Connection': 'keep-alive',
    ...Object.fromEntries(
      Object.entries(stream?.httpHeaders ?? {})
        .filter(([k]) => k.toLowerCase() !== 'user-agent')
    ),
  };

  let drmProp: DRMProp = null;
  if (stream?.drm) {
    try { drmProp = toDRMTypeProp(stream.drm); } catch (e) {
      console.warn('[VideoPlayer] Failed to build DRM prop:', e);
    }
  }

  useEffect(() => {
    if (!stream) return;
    console.log(
      `[VideoPlayer] 📺 → type=${stream.type} drm=${drmProp?.type ?? 'none'} ua=${sourceHeaders['User-Agent']} url=${stream.url}`,
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream?.url]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>

      {stream && (
        <View style={styles.videoWrapper} pointerEvents="none">
          <Video
            key={stream.url}
            ref={videoRef}
            source={{
              uri:     stream.url,
              type:    stream.type,    // critical: tells ExoPlayer HLS vs DASH
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
            minLoadRetryCount={2}      // ExoPlayer retries internally 2× before surfacing error to JS
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
              <Text style={styles.drmBadgeText}>
                🔐 {stream.drm.type.toUpperCase()}
                {stream.drm.type === 'clearkey' && (stream.drm as ClearKeyDRM).licenseServer
                  ? ' (URL KEY)' : stream.drm.type === 'clearkey' ? ' (INLINE)' : ''}
              </Text>
            </View>
          )}

          {errorMessage && (
            <Text style={styles.overlayError} numberOfLines={3}>
              ⚠️ {errorMessage}
            </Text>
          )}
        </View>
      )}
    </View>
  );
};

// ─── Public export ────────────────────────────────────────────────────────────

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