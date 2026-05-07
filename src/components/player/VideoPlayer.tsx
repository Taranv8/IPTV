// src/components/player/VideoPlayer.tsx
//
// LIVE-STREAM OPTIMISATIONS (this version)
//
// 1. bufferForPlaybackMs: 200 (was 500)
//    ExoPlayer starts playing after just 200 ms of buffered data — the
//    single biggest win for "instant" channel switching on a decent link.
//
// 2. backBufferDurationMs: 0 (was 3 000)
//    Live streams never need to seek backward. Dropping the back buffer
//    frees ExoPlayer to focus bandwidth entirely on the forward edge.
//
// 3. minBufferMs: 1 000 | maxBufferMs: 8 000 (was 3 000 / 15 000)
//    Keeping the look-ahead window short means ExoPlayer chases the live
//    edge more aggressively instead of buffering segments far into the
//    future (which also prevents signed-token expiry issues).
//
// 4. bufferForPlaybackAfterRebufferMs: 1 000 (was 2 500)
//    Resumes faster after a network hiccup — the most common mid-watch
//    disruption on mobile/Wi-Fi.
//
// 5. Resolver skipped on source failover
//    StreamResolver does a HEAD (or GET) against the URL before handing
//    it to ExoPlayer — useful for the initial load but pure dead time when
//    switching to a backup source that is already a known .m3u8/.mpd.
//    reconnect() now passes the raw StreamUrl entry straight to ExoPlayer;
//    only the very first load goes through the resolver.
//
// 6. STALL_TIMEOUT_MS: 8 000 (was 15 000)
//    15 s of stall is too long to ask a viewer to wait before we try the
//    next source. 8 s covers a normal rebuffer while still catching a truly
//    dead stream promptly.
//
// 7. RETRY_DELAY_MS: 2 000 | INTER_CYCLE_DELAY_MS: 6 000 (were 5 000 / 10 000)
//    Tighter retry pacing without hammering servers.
//
// 8. automaticallyWaitsToMinimizeStalling: false (iOS)
//    Prevents AVPlayer from holding back playback start waiting to fill a
//    larger buffer on slow links — we want the first frame now, not later.
//
// 9. All other logic (stall watchdog, channelRef, hasLoadedOnce reset on
//    reconnect, single-object spinner state) is unchanged from the previous
//    version — those patterns are already correct.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Text,
  Platform,
  AppState,
  AppStateStatus,
} from 'react-native';
import Video, { OnLoadData, DRMType } from 'react-native-video';
import { Channel } from '../../types/channel';
import {
  StreamResolver,
  ResolvedStream,
  DRMConfig,
  ClearKeyDRM,
  getStreamType,
  VLC_USER_AGENT,
} from '../../services/stream/StreamResolver';
import { VideoErrorBoundary } from './VideoErrorBoundary';

// ─── Timing constants ─────────────────────────────────────────────────────────

const STALL_TIMEOUT_MS     =  8_000;   // ↓ was 15 000 — detect dead streams faster
const RETRY_DELAY_MS       =  2_000;   // ↓ was  5 000
const INTER_CYCLE_DELAY_MS =  6_000;   // ↓ was 10 000

// ─── ExoPlayer error codes ────────────────────────────────────────────────────

const EXO_BEHIND_LIVE_WINDOW    = 21002;
const EXO_BAD_HTTP_STATUS       = 22004;
const EXO_MANIFEST_MALFORMED    = 23002;
const EXO_CONTAINER_UNSUPPORTED = 23003;

const SKIP_NOW_CODES = new Set([
  EXO_BAD_HTTP_STATUS,
  EXO_MANIFEST_MALFORMED,
  EXO_CONTAINER_UNSUPPORTED,
]);

// ─── Buffer config (tuned for live TV) ───────────────────────────────────────
//
//  bufferForPlaybackMs: 200
//    Start on just 0.2 s of data. Feels nearly instant on a 4G/Wi-Fi link.
//
//  bufferForPlaybackAfterRebufferMs: 1 000
//    Resume fast after a brief stall — no need to re-fill a large buffer.
//
//  backBufferDurationMs: 0
//    Live means forward-only. Freeing the back buffer concentrates bandwidth
//    on the segment ExoPlayer is about to play.
//
//  maxBufferMs: 8 000
//    Keep the look-ahead window tight. Signed segment tokens (hdnea, etc.)
//    expire in 20–30 s; fetching 8 s ahead leaves plenty of safety margin
//    while keeping the player right behind the live edge.

const BUFFER_CONFIG = {
  minBufferMs:                       1_000,   // ↓ was 3 000
  maxBufferMs:                       8_000,   // ↓ was 15 000
  bufferForPlaybackMs:                 200,   // ↓ was   500 — biggest UX win
  bufferForPlaybackAfterRebufferMs:  1_000,   // ↓ was 2 500
  backBufferDurationMs:                  0,   // ↓ was 3 000 — live = no back buffer
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
      if (ck.clearkeys && Object.keys(ck.clearkeys).length > 0)
        return { type: DRMType.CLEARKEY, clearkeys: ck.clearkeys };
      if (ck.licenseServer)
        return { type: DRMType.CLEARKEY, licenseServer: ck.licenseServer };
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

// ─── Spinner status ───────────────────────────────────────────────────────────

interface SpinnerStatus { visible: boolean; label: string; error: string | null }

const RESOLVING: SpinnerStatus = { visible: true,  label: 'Resolving stream…', error: null };
const LOADING:   SpinnerStatus = { visible: true,  label: 'Loading channel…',  error: null };
const BUFFERING: SpinnerStatus = { visible: true,  label: 'Buffering…',        error: null };
const HIDDEN:    SpinnerStatus = { visible: false, label: '',                  error: null };

function errorStatus(label: string, error: string): SpinnerStatus {
  return { visible: true, label, error };
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  channel: Channel;
  fullscreen?: boolean;
  onFullscreenDismiss?: () => void;
}
// ─── Inner player ─────────────────────────────────────────────────────────────

const VideoPlayerInner: React.FC<Props> = ({ channel, fullscreen = false, onFullscreenDismiss }) => {

  const [stream,  setStream]  = useState<ResolvedStream | null>(null);
  const [spinner, setSpinner] = useState<SpinnerStatus>(RESOLVING);

  const videoRef      = useRef<any>(null);
  const cancelledRef  = useRef(false);
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasLoadedOnce = useRef(false);

  // Source round-robin
  const sourceIndexRef  = useRef(0);
  const triedInCycleRef = useRef(0);
  const totalSourcesRef = useRef(0);

  // Stable refs so callbacks never capture stale state
  const streamRef  = useRef<ResolvedStream | null>(null);
  const channelRef = useRef(channel);
  useEffect(() => { streamRef.current = stream; },   [stream]);
  useEffect(() => { channelRef.current = channel; }, [channel]);

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

  // ── Source advance ────────────────────────────────────────────────────────

  const advanceSource = useCallback((): { url: string; entry: any } | null => {
    const urls = channel.streamUrls ?? [];
    if (urls.length === 0) return null;

    totalSourcesRef.current = urls.length;
    triedInCycleRef.current += 1;

    const idx              = sourceIndexRef.current % urls.length;
    sourceIndexRef.current = (idx + 1) % urls.length;

    const entry = urls[idx];
    console.log(
      `[VideoPlayer] 🔀 Source ${idx + 1}/${urls.length}: "${entry?.source ?? 'unknown'}" — ${entry?.url}`,
    );
    return { url: entry?.url, entry };
  }, [channel.streamUrls]);

  // ── Build a ResolvedStream directly from a StreamUrl entry ────────────────
  //
  // On source failover we skip StreamResolver entirely (no HEAD/GET round-trip)
  // and hand the raw URL straight to ExoPlayer. This saves 1–2 s per switch.
  //
  // The resolver is still used for the initial load because the first URL may
  // be an opaque wrapper that needs unwrapping.

  const buildStreamDirect = useCallback((entry: any): ResolvedStream => {
    const url = typeof entry === 'string' ? entry : entry?.url ?? '';

    const rawUA    = entry?.userAgent ?? '';
    const stripped = rawUA.startsWith('@') ? rawUA.slice(1) : rawUA;
    const looksReal =
      stripped.length > 0 &&
      (stripped.includes('/') || stripped.toLowerCase().includes('mozilla'));
    const userAgent = looksReal ? stripped : VLC_USER_AGENT;

    const rawHeaders = entry?.httpHeaders;
    const httpHeaders: Record<string, string> | undefined = (() => {
      if (!rawHeaders || Object.keys(rawHeaders).length === 0) return undefined;
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(rawHeaders)) {
        if (k.toLowerCase() === 'user-agent') continue;
        out[k.toLowerCase() === 'cookie' ? 'Cookie' : k] = v as string;
      }
      return Object.keys(out).length > 0 ? out : undefined;
    })();

    return { url, type: getStreamType(url), userAgent, httpHeaders, drm: null };
  }, []);

  // ── Full reconnect — uses raw URL, skips resolver ─────────────────────────

  const reconnect = useCallback(async (skipNow = false) => {
    if (cancelledRef.current) return;

    // Disarm the stall watchdog so it doesn't fire during the new source's
    // initial buffer-fill phase (same fix as the previous version).
    hasLoadedOnce.current = false;
    clearAllTimers();

    const next = advanceSource();

    if (!next) {
      setSpinner(errorStatus('No sources available', 'No stream sources configured for this channel'));
      return;
    }

    const allSourcesTried = triedInCycleRef.current >= totalSourcesRef.current;
    if (allSourcesTried && !skipNow) {
      const secs = INTER_CYCLE_DELAY_MS / 1_000;
      console.warn(`[VideoPlayer] All ${totalSourcesRef.current} sources failed — waiting ${secs}s`);
      setSpinner(errorStatus(`All sources failed — retrying in ${secs}s…`, ''));
      triedInCycleRef.current = 0;
      retryTimerRef.current   = setTimeout(() => {
        if (!cancelledRef.current) reconnectRef.current();
      }, INTER_CYCLE_DELAY_MS);
      return;
    }

    setSpinner({
      ...LOADING,
      label: `Trying source… (${Math.min(triedInCycleRef.current, totalSourcesRef.current)}/${totalSourcesRef.current})`,
    });

    // ── Skip resolver: hand the raw entry straight to ExoPlayer ──────────
    const resolved = buildStreamDirect(next.entry ?? next.url);
    console.log(`[VideoPlayer] ⚡ Direct → ${resolved.type}: ${resolved.url}`);
    setStream({ ...resolved });
  }, [advanceSource, buildStreamDirect, clearAllTimers]);

  useEffect(() => { reconnectRef.current = reconnect; }, [reconnect]);

  const scheduleRetry = useCallback((skipNow = false) => {
    if (cancelledRef.current) return;
    clearRetryTimer();
    retryTimerRef.current = setTimeout(() => {
      if (!cancelledRef.current) reconnectRef.current(skipNow);
    }, skipNow ? 0 : RETRY_DELAY_MS);
  }, [clearRetryTimer]);

  useEffect(() => { scheduleRetryRef.current = scheduleRetry; }, [scheduleRetry]);

  // ── Stall watchdog ────────────────────────────────────────────────────────

  const startStallWatchdog = useCallback(() => {
    if (!hasLoadedOnce.current) return;
    clearStallTimer();
    stallTimerRef.current = setTimeout(() => {
      if (cancelledRef.current) return;
      console.warn(`[VideoPlayer] ⚠️ Stall ${STALL_TIMEOUT_MS / 1_000}s — switching source`);
      reconnectRef.current(false);
    }, STALL_TIMEOUT_MS);
  }, [clearStallTimer]);

  // ── Initial load (resolver runs here, once per channel) ───────────────────

  useEffect(() => {
    if (!channel?.streamUrl && !channel?.streamUrls?.length) return;

    cancelledRef.current = true;
    clearAllTimers();

    cancelledRef.current    = false;
    hasLoadedOnce.current   = false;
    sourceIndexRef.current  = 0;
    triedInCycleRef.current = 0;
    totalSourcesRef.current = channel.streamUrls?.length ?? 0;

    setStream(null);
    setSpinner(RESOLVING);

    console.log(`[VideoPlayer] ── "${channel.name}" | ${totalSourcesRef.current} source(s)`);

    const firstEntry = channel.streamUrls?.[0] ?? channel.streamUrl;

    (async () => {
      let resolved: ResolvedStream | null = null;
      try {
        resolved = await StreamResolver.resolve(firstEntry);
        sourceIndexRef.current  = 1;
        triedInCycleRef.current = 1;
      } catch (e: any) {
        console.error('[VideoPlayer] Initial resolve error:', e?.message ?? e);
      }

      if (cancelledRef.current) return;

      if (resolved) {
        console.log(`[VideoPlayer] ✅ Initial → ${resolved.type}: ${resolved.url}`);
        setStream(resolved);
        setSpinner(LOADING);
      } else {
        // Resolver failed — switch to the next source immediately
        reconnectRef.current(true);
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
    clearStallTimer();
  }, [clearStallTimer]);

  const handleLoad = useCallback((_: OnLoadData) => {
    if (cancelledRef.current) return;
    console.log(`[VideoPlayer] 📋 Metadata loaded "${channelRef.current.name}"`);
  }, []);

  // Hides the spinner on the first decoded video frame — not on metadata.
  const handleReadyForDisplay = useCallback(() => {
    if (cancelledRef.current) return;
    clearAllTimers();
    hasLoadedOnce.current   = true;
    triedInCycleRef.current = 0;
    setSpinner(HIDDEN);
    console.log(`[VideoPlayer] ▶️ Playing "${channelRef.current.name}"`);
  }, [clearAllTimers]);

  const handleBuffer = useCallback(({ isBuffering }: { isBuffering: boolean }) => {
    if (cancelledRef.current) return;
    if (!isBuffering) {
      clearStallTimer();
      setSpinner(HIDDEN);
      return;
    }
    setSpinner(BUFFERING);
    startStallWatchdog();
  }, [clearStallTimer, startStallWatchdog]);

  const handleError = useCallback((err: any) => {
    if (cancelledRef.current) return;

    const code   = err?.error?.errorCode   as number | undefined;
    const msg    = err?.error?.errorString as string | undefined;
    const domain = err?.error?.domain      as string | undefined;

    const ch  = channelRef.current;
    const stm = streamRef.current;

    console.error(`[VideoPlayer] ❌ ExoPlayer | code=${code ?? 'n/a'} | ${msg ?? 'n/a'}`);
    clearAllTimers();
    setSpinner(errorStatus('Playback error', `[${code ?? '?'}] ${msg ?? 'Playback error'}`));

    if (code === EXO_BEHIND_LIVE_WINDOW) {
      setSpinner({ ...LOADING, label: 'Catching up to live…' });
      seekToLiveEdge();
      return;
    }

    const skipNow = code !== undefined && SKIP_NOW_CODES.has(code);
    if (skipNow) console.warn(`[VideoPlayer] Fatal error ${code} — skipping source now`);

    // Fire-and-forget — don't await so it never blocks the retry path
    safeReport('Playback error', 'PLAYBACK_ERROR', {
      channelId:   ch.id,
      channelName: ch.name,
      streamUrl:   stm?.url ?? ch.streamUrl,
      streamType:  stm?.type,
      hasDRM:      !!stm?.drm,
      drmType:     stm?.drm?.type,
      exoCode:     code,
      exoMsg:      msg,
      exoDomain:   domain,
    });

    scheduleRetryRef.current(skipNow);
  }, [clearAllTimers, seekToLiveEdge]);

  // ── Source / DRM props ────────────────────────────────────────────────────

  const sourceHeaders = useMemo<Record<string, string>>(() => {
    if (!stream) return {};
    return {
      'User-Agent': (stream.userAgent && !stream.userAgent.startsWith('@'))
        ? stream.userAgent
        : VLC_USER_AGENT,
      'Accept':     ACCEPT_HEADER,
      'Connection': 'keep-alive',
      ...Object.fromEntries(
        Object.entries(stream.httpHeaders ?? {})
          .filter(([k]) => k.toLowerCase() !== 'user-agent'),
      ),
    };
  }, [stream]);

  const drmProp = useMemo<DRMProp>(() => {
    if (!stream?.drm) return null;
    try { return toDRMTypeProp(stream.drm); } catch (e) {
      console.warn('[VideoPlayer] Failed to build DRM prop:', e);
      return null;
    }
  }, [stream?.drm]);

  useEffect(() => {
    if (!stream) return;
    console.log(
      `[VideoPlayer] 📺 → type=${stream.type} drm=${drmProp?.type ?? 'none'} url=${stream.url}`,
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream?.url]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>

      {stream && (
        <View style={[styles.videoWrapper, { pointerEvents: 'none' }]}>
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
            minLoadRetryCount={0}              // surface errors to JS immediately
            automaticallyWaitsToMinimizeStalling={false}  // iOS: don't wait to fill buffer
            reportBandwidth={false}
            onLoadStart={handleLoadStart}
            onLoad={handleLoad}
            onReadyForDisplay={handleReadyForDisplay}  // hide spinner on first frame
            onError={handleError}
            fullscreen={fullscreen}
onFullscreenPlayerWillDismiss={onFullscreenDismiss}
            onBuffer={handleBuffer}
            focusable={false}
            {...(drmProp ? { drm: drmProp } : {})}
            {...(Platform.isTV ? { isTVSelectable: false } : {})}
          />
        </View>
      )}

      {spinner.visible && (
        <View style={styles.overlay}>
          <ActivityIndicator size="large" color="#3b82f6" />
          <Text style={styles.overlayLabel}>{spinner.label}</Text>
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

          {spinner.error ? (
            <Text style={styles.overlayError} numberOfLines={3}>
              ⚠️ {spinner.error}
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
};

// ─── Public export ────────────────────────────────────────────────────────────

const VideoPlayer: React.FC<Props> = ({ channel, fullscreen, onFullscreenDismiss }) => {
  const [boundaryKey, setBoundaryKey] = useState(0);
  return (
    <VideoErrorBoundary
      key={boundaryKey}
      channelName={channel.name}
      onRetry={() => setBoundaryKey(k => k + 1)}
    >
      <VideoPlayerInner
        channel={channel}
        fullscreen={fullscreen}
        onFullscreenDismiss={onFullscreenDismiss}
      />
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
  drmBadgeText: { color: '#93c5fd', fontSize: 11, fontWeight: '600', letterSpacing: 0.5 },
});

export default VideoPlayer;