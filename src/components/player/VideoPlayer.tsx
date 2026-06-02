// src/components/player/VideoPlayer.tsx
//
// HARD-RESTART ON MID-STREAM 22004  (on top of stream-health additions)
//
// Problem that prompted this change
// ──────────────────────────────────
// ExoPlayer fires ERROR_CODE_IO_BAD_HTTP_STATUS (22004) after several minutes
// of successful playback.  This is almost always a transient CDN / auth-token
// refresh — the URL itself is still valid.  The previous code treated it the
// same as a pre-play fatal error and immediately advanced to the next source,
// cycling away from the only working URL.
//
// Fix
// ───
// • hasLoadedOnce tracks whether the current source ever produced a frame.
// • hardRestartCountRef tracks per-source hard-restart attempts.
// • When 22004 fires AND the source was playing (hasLoadedOnce = true) AND we
//   haven't yet tried a hard restart → force-remount the <Video> on the SAME
//   URL (streamRestartKey bump changes the key even though the URL is the
//   same) and show "Reconnecting…".
// • Only if the hard restart also fails do we advance to the next source.
// • hardRestartCountRef resets to 0 on every successful first-frame
//   (handleReadyForDisplay) and on every source advance (reconnect).
// • MAX_HARD_RESTARTS = 1  (one silent reconnect; more would just stall the
//   user unnecessarily).
//
// All previous additions (stream-health, stall watchdog, buffer config, etc.)
// are unchanged.
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
import { StreamHealthService, HealthMap } from '../../services/stream/StreamHealthService';
import { VideoErrorBoundary } from './VideoErrorBoundary';

// ─── Timing constants ─────────────────────────────────────────────────────────

const STALL_TIMEOUT_MS     =  20000;
const RETRY_DELAY_MS       =  2_000;
const INTER_CYCLE_DELAY_MS =  6_000;

// ─── Hard-restart config ──────────────────────────────────────────────────────
// How many silent in-place restarts to attempt on the same URL before giving
// up and advancing to the next source.  1 is enough for most CDN hiccups.
const MAX_HARD_RESTARTS = 1;

// ─── ExoPlayer error codes ────────────────────────────────────────────────────

const EXO_BEHIND_LIVE_WINDOW    = 21002;
const EXO_BAD_HTTP_STATUS       = 22004;
const EXO_MANIFEST_MALFORMED    = 23002;
const EXO_CONTAINER_UNSUPPORTED = 23003;

// Errors that should skip the current source immediately when they fire
// BEFORE the stream has ever played (pre-play fatal).
const SKIP_NOW_CODES = new Set([
  EXO_BAD_HTTP_STATUS,
  EXO_MANIFEST_MALFORMED,
  EXO_CONTAINER_UNSUPPORTED,
]);

// ─── Buffer config (tuned for live TV) ───────────────────────────────────────

const BUFFER_CONFIG = {
 minBufferMs: 10000,
  maxBufferMs: 20000,
  bufferForPlaybackMs: 2500,
  bufferForPlaybackAfterRebufferMs: 5000,
  backBufferDurationMs: 0,
  cacheSizeMb: 100,
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

const RESOLVING:     SpinnerStatus = { visible: true,  label: 'Resolving stream…',  error: null };
const LOADING:       SpinnerStatus = { visible: true,  label: 'Loading channel…',   error: null };
const BUFFERING:     SpinnerStatus = { visible: true,  label: 'Buffering…',         error: null };
const RECONNECTING:  SpinnerStatus = { visible: true,  label: 'Reconnecting…',      error: null };
const HIDDEN:        SpinnerStatus = { visible: false, label: '',                   error: null };

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

  const [stream,           setStream]           = useState<ResolvedStream | null>(null);
  const [spinner,          setSpinner]          = useState<SpinnerStatus>(RESOLVING);
  const [containerReady,   setContainerReady]   = useState(false);
  // ── NEW: bumping this forces <Video> to remount even when the URL is the same
  const [streamRestartKey, setStreamRestartKey] = useState(0);

  const videoRef      = useRef<any>(null);
  const cancelledRef  = useRef(false);
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasLoadedOnce = useRef(false);

  // Source round-robin
  const sourceIndexRef  = useRef(0);
  const triedInCycleRef = useRef(0);
  const totalSourcesRef = useRef(0);

  // ── NEW: hard-restart tracking ────────────────────────────────────────────
  // hardRestartCountRef — how many times we've silently restarted the
  //   *current* source URL after a mid-stream 22004 error.
  // currentEntryRef     — the raw StreamUrl entry currently being played,
  //   needed to rebuild the same ResolvedStream for a hard restart.
  const hardRestartCountRef = useRef(0);
  const currentEntryRef     = useRef<any>(null);

  // Stream health
  const healthRef     = useRef<HealthMap>({});
  const sortedUrlsRef = useRef<NonNullable<Channel['streamUrls']>>([]);

  // Stable refs
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
    const urls = sortedUrlsRef.current.length
      ? sortedUrlsRef.current
      : (channel.streamUrls ?? []);

    if (urls.length === 0) return null;

    totalSourcesRef.current = urls.length;
    triedInCycleRef.current += 1;

    const idx              = sourceIndexRef.current % urls.length;
    sourceIndexRef.current = (idx + 1) % urls.length;

    const entry = urls[idx];
    const stat  = healthRef.current[entry?.url ?? ''];
    const tag   = stat ? `score=${stat.score} dead=${stat.isDead}` : 'new/unknown';

    console.log(
      `[VideoPlayer] 🔀 Source ${idx + 1}/${urls.length}: ` +
      `"${entry?.source ?? 'unknown'}" [${tag}] — ${entry?.url}`,
    );

    return { url: entry?.url, entry };
  }, [channel.streamUrls]);

  // ── Build ResolvedStream from a StreamUrl entry ───────────────────────────

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

  // ── NEW: hard restart — same source URL, new <Video> instance ────────────
  //
  // Forces a full Video remount on the current URL by bumping streamRestartKey.
  // The key on <Video> is `${stream.url}-${streamRestartKey}`, so even if the
  // URL string is identical React will unmount → remount the native player,
  // which is equivalent to the user switching away and back.

  const hardRestartStream = useCallback(() => {
    if (cancelledRef.current) return;

    const entry = currentEntryRef.current;
    if (!entry) {
      // No entry to restart from — fall back to normal source advance
      scheduleRetryRef.current(true);
      return;
    }

    hardRestartCountRef.current += 1;
    hasLoadedOnce.current = false;
    clearAllTimers();

    const resolved = buildStreamDirect(entry);
    console.log(
      `[VideoPlayer] 🔄 Hard restart #${hardRestartCountRef.current}` +
      ` on same source: ${resolved.url}`,
    );

    setSpinner(RECONNECTING);
    // Update stream state first (same URL but fresh object), then bump the
    // restart key so the Video key prop actually changes and triggers a remount.
    setStream({ ...resolved });
    setStreamRestartKey(k => k + 1);
  }, [buildStreamDirect, clearAllTimers]);

  // ── Full reconnect — advance source ──────────────────────────────────────

  const reconnect = useCallback(async (skipNow = false) => {
    if (cancelledRef.current) return;

    hasLoadedOnce.current   = false;
    hardRestartCountRef.current = 0;   // ← reset hard-restart budget
    currentEntryRef.current = null;
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

    currentEntryRef.current = next.entry ?? next.url;  // ← track the entry
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
      const stalledUrl = streamRef.current?.url ?? '';
      const ch         = channelRef.current;
      console.warn(`[VideoPlayer] ⚠️ Stall ${STALL_TIMEOUT_MS / 1_000}s — switching source`);

      if (stalledUrl) {
        StreamHealthService.report(ch.id, stalledUrl, 'stall', STALL_TIMEOUT_MS);
      }

      reconnectRef.current(false);
    }, STALL_TIMEOUT_MS);
  }, [clearStallTimer]);

  // ── Initial load ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!channel?.streamUrl && !channel?.streamUrls?.length) return;

    cancelledRef.current = true;
    clearAllTimers();

    cancelledRef.current        = false;
    hasLoadedOnce.current       = false;
    hardRestartCountRef.current = 0;
    currentEntryRef.current     = null;
    sourceIndexRef.current      = 0;
    triedInCycleRef.current     = 0;
    healthRef.current           = {};

    sortedUrlsRef.current   = channel.streamUrls ?? [];
    totalSourcesRef.current = sortedUrlsRef.current.length;

    setStream(null);
    setSpinner(RESOLVING);
    setContainerReady(false);
    setStreamRestartKey(0);

    console.log(`[VideoPlayer] ── "${channel.name}" | ${totalSourcesRef.current} source(s)`);

    (async () => {
      // Step 1: fetch health and sort URLs
      const health = await StreamHealthService.fetchHealth(channel.id);
      if (cancelledRef.current) return;

      healthRef.current       = health;
      const sorted            = StreamHealthService.sort(channel.streamUrls ?? [], health);
      sortedUrlsRef.current   = sorted;
      totalSourcesRef.current = sorted.length;

      const deadCount = sorted.filter(e => health[e.url]?.isDead).length;
      if (deadCount > 0) {
        console.log(
          `[VideoPlayer] 💀 ${deadCount}/${sorted.length} sources marked dead — sorted to back`,
        );
      }

      if (cancelledRef.current) return;

      // Step 2: resolve the first (healthiest) source
      const firstEntry = sorted[0] ?? channel.streamUrl;

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
        currentEntryRef.current = firstEntry;   // ← track the entry
        setStream(resolved);
        setSpinner(LOADING);
      } else {
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

  const handleReadyForDisplay = useCallback(() => {
    if (cancelledRef.current) return;

    clearAllTimers();
    hasLoadedOnce.current       = true;
    triedInCycleRef.current     = 0;
    hardRestartCountRef.current = 0;   // ← reset: stream is healthy again
    setSpinner(HIDDEN);

    const url = streamRef.current?.url ?? '';
    const ch  = channelRef.current;
    console.log(`[VideoPlayer] ▶️ Playing "${ch.name}"`);

    if (url) StreamHealthService.report(ch.id, url, 'success');
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

  // ── UPDATED handleError ───────────────────────────────────────────────────
  //
  // New logic for EXO_BAD_HTTP_STATUS (22004):
  //
  //   • Fired BEFORE first frame (hasLoadedOnce = false)
  //     → same as before: skip to next source immediately.
  //
  //   • Fired AFTER successful playback (hasLoadedOnce = true)
  //     AND hard-restart budget remaining
  //     → silent hard restart on the SAME URL (CDN/token hiccup).
  //
  //   • Fired AFTER successful playback AND budget exhausted
  //     → report error + advance source normally.

  const handleError = useCallback((err: any) => {
    if (cancelledRef.current) return;

    const code   = err?.error?.errorCode   as number | undefined;
    const msg    = err?.error?.errorString as string | undefined;
    const domain = err?.error?.domain      as string | undefined;

    const ch  = channelRef.current;
    const stm = streamRef.current;

    console.error(`[VideoPlayer] ❌ ExoPlayer | code=${code ?? 'n/a'} | ${msg ?? 'n/a'}`);
    clearAllTimers();

    // ── Special case: seek to live edge ───────────────────────────────────
    if (code === EXO_BEHIND_LIVE_WINDOW) {
      setSpinner({ ...LOADING, label: 'Catching up to live…' });
      seekToLiveEdge();
      return;
    }

    // ── NEW: mid-stream 22004 → attempt hard restart first ────────────────
    if (
      code === EXO_BAD_HTTP_STATUS &&
      hasLoadedOnce.current &&
      hardRestartCountRef.current < MAX_HARD_RESTARTS
    ) {
      console.warn(
        `[VideoPlayer] ⚡ Mid-stream 22004 — attempting hard restart ` +
        `(${hardRestartCountRef.current + 1}/${MAX_HARD_RESTARTS})`,
      );
      // Report to health service (non-fatal — stream may recover)
      if (stm?.url) StreamHealthService.report(ch.id, stm.url, 'error');
      hardRestartStream();
      return;
    }

    // ── Normal error handling ─────────────────────────────────────────────
    setSpinner(errorStatus('Playback error', `[${code ?? '?'}] ${msg ?? 'Playback error'}`));

    if (stm?.url) {
      StreamHealthService.report(ch.id, stm.url, 'error');
    }

    const skipNow = code !== undefined && SKIP_NOW_CODES.has(code);
    if (skipNow) console.warn(`[VideoPlayer] Fatal error ${code} — skipping source now`);

    safeReport('Playback error', 'PLAYBACK_ERROR', {
      channelId:             ch.id,
      channelName:           ch.name,
      streamUrl:             stm?.url ?? ch.streamUrl,
      streamType:            stm?.type,
      hasDRM:                !!stm?.drm,
      drmType:               stm?.drm?.type,
      exoCode:               code,
      exoMsg:                msg,
      exoDomain:             domain,
      hardRestartAttempts:   hardRestartCountRef.current,
    });

    scheduleRetryRef.current(skipNow);
  }, [clearAllTimers, seekToLiveEdge, hardRestartStream]);

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
  }, [stream?.url, streamRestartKey]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View
      style={styles.container}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        if (width > 0 && height > 0 && !containerReady) {
          setContainerReady(true);
        }
      }}
    >
      {stream && containerReady && (
        <View style={[styles.videoWrapper, { pointerEvents: 'none' }]}>
          <Video
            // ── CHANGED: include streamRestartKey so a hard restart on the
            // same URL still gives React a new key and forces a full remount.
            key={`${stream.url}-${streamRestartKey}`}
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
            minLoadRetryCount={0}
            automaticallyWaitsToMinimizeStalling={false}
            reportBandwidth={true}
            onLoadStart={handleLoadStart}
            onLoad={handleLoad}
            onReadyForDisplay={handleReadyForDisplay}
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