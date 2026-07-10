// src/components/player/VideoPlayer.tsx
//
// HARD-RESTART ON MID-STREAM 22004 + IN-STREAM ADS VIA GOOGLE IMA
//
// ─── What changed in this revision ───────────────────────────────────────────
//
// Ads no longer go through hand-rolled VAST XML parsing + manual source
// swapping. Instead this hands the VAST tag URL straight to react-native-video,
// which uses ExoPlayer's IMA extension on Android and the native IMA SDK on
// iOS to fetch/parse/schedule/track the ad itself.
//
// PROP SHAPE: confirmed against this project's installed react-native-video
// types (not guessed) — ads go under the nested `source.ad` field, and
// AdConfig is a discriminated union that requires `type: 'csai'` alongside
// `adTagUrl` for client-side ad insertion:
//     source={{ uri, type, headers, ad: { type: 'csai', adTagUrl } }}
// If you upgrade react-native-video and this starts failing to typecheck
// again, trust the compiler error over this comment — the shape has moved
// around across versions historically.
//
// You must also enable IMA natively before any of this does anything:
//   iOS Podfile:            $RNVideoUseGoogleIMA=true
//   Android build.gradle:   useExoplayerIMA = true
//
// ─── How ad breaks are triggered now ─────────────────────────────────────────
//
//   1. PRE-ROLL — on every channel change, if AdService.shouldPlayOnChannelChange()
//      says it's time, we set `adTagUrl` state BEFORE the new channel's
//      <Video> mounts. IMA sees the ad tag attached to the same element as
//      the content source and plays the ad first, then auto-resumes content.
//
//   2. MID-ROLL — a timer armed after each successful content first-frame,
//      same as before. When it fires and AdService.canPlayMidRoll() says
//      yes, we set `adTagUrl` AND bump `streamRestartKey` to force a fresh
//      <Video> mount — this is required because there is no imperative
//      "request an ad now" API; IMA only requests the tag on mount/prop
//      attach. This costs a brief reconnect, same as your existing
//      hard-restart already does for mid-stream 22004 errors.
//
// Ad lifecycle (start/end/error) is now driven entirely by onReceiveAdEvent,
// not by our own state machine — see handleAdEvent below. The live-TV
// failover machinery (hard-restart, source cycling, stall watchdog, health
// reporting) is untouched for `mode === 'content'`.
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
import Video, { OnLoadData, DRMType, ViewType } from 'react-native-video';
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
import AdService, { VAST_AD_TAG_URL } from '../../services/ads/AdService';

// ─── Timing constants ─────────────────────────────────────────────────────────

const STALL_TIMEOUT_MS     =  20000;
const RETRY_DELAY_MS       =  2_000;
const INTER_CYCLE_DELAY_MS =  6_000;

// ─── Hard-restart config ──────────────────────────────────────────────────────
const MAX_HARD_RESTARTS = 1;

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

// ─── IMA ad-event name buckets ────────────────────────────────────────────────
//
// react-native-video's onReceiveAdEvent event names differ slightly between
// Android and iOS, and real-world reports (TheWidlarzGroup/react-native-video
// issues #4423, #4688) show occasional duplicated/missing events across both
// platforms. Bucketing multiple possible event names — rather than relying on
// one exact name — makes this resilient to that flakiness.

const AD_START_EVENTS = new Set([
  'STARTED',
  'LOADED',
  'CONTENT_PAUSE_REQUESTED', // Android
  'AD_BREAK_STARTED',        // iOS
]);

const AD_END_EVENTS = new Set([
  'ALL_ADS_COMPLETED',
  'COMPLETED',
  'CONTENT_RESUME_REQUESTED', // Android
  'AD_BREAK_ENDED',           // iOS
]);

const AD_ERROR_EVENTS = new Set(['AD_ERROR', 'ERROR']);

// Derived from <Video>'s own prop types rather than hand-typed, so this
// always matches whatever event union your installed react-native-video
// version actually exposes (it varies by version — see the TS errors this
// was written to fix).
type AdEventHandler = NonNullable<React.ComponentProps<typeof Video>['onReceiveAdEvent']>;
type AdEvent = Parameters<AdEventHandler>[0];

// Same idea for the `source` prop — lets TS validate the `ad: { type: 'csai', adTagUrl }`
// shape against your actual installed version instead of a guessed shape.
type VideoSourceProp = React.ComponentProps<typeof Video>['source'];

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

function formatCountdown(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  channel: Channel;
  fullscreen?: boolean;
  paused?: boolean; 
  onFullscreenDismiss?: () => void;
}

// ─── Inner player ─────────────────────────────────────────────────────────────

const VideoPlayerInner: React.FC<Props> = ({ channel, fullscreen = false, paused = false, onFullscreenDismiss }) => {

  const [stream,           setStream]           = useState<ResolvedStream | null>(null);
  const [spinner,          setSpinner]          = useState<SpinnerStatus>(RESOLVING);
  const [containerReady,   setContainerReady]   = useState(false);
  const [streamRestartKey, setStreamRestartKey] = useState(0);

  // 'content' = playing a channel normally (all existing failover logic
  // applies). 'ad' = IMA is currently rendering an ad break on top of / in
  // place of the content. Driven entirely by onReceiveAdEvent now.
  const [mode,        setMode]        = useState<'content' | 'ad'>('content');
  const [adRemaining, setAdRemaining] = useState(0); // best-effort countdown; Android AD_PROGRESS only

  // Set right before a fresh <Video> mount when a pre-roll or mid-roll
  // should play. Cleared once IMA signals the ad break ended.
  const [adTagUrl, setAdTagUrl] = useState<string | undefined>(undefined);

  const videoRef      = useRef<any>(null);
  const cancelledRef  = useRef(false);
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasLoadedOnce = useRef(false);

  // Source round-robin (content only)
  const sourceIndexRef  = useRef(0);
  const triedInCycleRef = useRef(0);
  const totalSourcesRef = useRef(0);

  // Hard-restart tracking (content only)
  const hardRestartCountRef = useRef(0);
  const currentEntryRef     = useRef<any>(null);

  // Stream health (content only)
  const healthRef     = useRef<HealthMap>({});
  const sortedUrlsRef = useRef<NonNullable<Channel['streamUrls']>>([]);

  const midRollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped on every loadChannel() call; lets a stale in-flight async op
  // recognize it's been superseded and bail out instead of clobbering newer
  // state.
  const loadGenRef      = useRef(0);

  // Stable refs
  const streamRef     = useRef<ResolvedStream | null>(null);
  const channelRef    = useRef(channel);
  const modeRef       = useRef<'content' | 'ad'>('content');
  const appActiveRef  = useRef(true);
  useEffect(() => { streamRef.current = stream; },   [stream]);
  useEffect(() => { channelRef.current = channel; }, [channel]);
  useEffect(() => { modeRef.current = mode; },       [mode]);

  const reconnectRef       = useRef<(skipNow?: boolean) => Promise<void>>(async () => {});
  const scheduleRetryRef   = useRef<(skipNow?: boolean) => void>(() => {});
  const loadChannelRef     = useRef<() => Promise<void>>(async () => {});

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

  useEffect(() => { appActiveRef.current = appActive; }, [appActive]);

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

  const clearMidRollTimer = useCallback(() => {
    if (midRollTimerRef.current) { clearTimeout(midRollTimerRef.current); midRollTimerRef.current = null; }
  }, []);

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

  // ── Source advance (content only) ─────────────────────────────────────────

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

  // ── Build ResolvedStream from a StreamUrl entry (content only) ───────────

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

  // ── Hard restart — same source URL, new <Video> instance (content only) ──

  const hardRestartStream = useCallback(() => {
    if (cancelledRef.current) return;

    const entry = currentEntryRef.current;
    if (!entry) {
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
    setStream({ ...resolved });
    setStreamRestartKey(k => k + 1);
  }, [buildStreamDirect, clearAllTimers]);

  // ── Full reconnect — advance source (content only) ───────────────────────

  const reconnect = useCallback(async (skipNow = false) => {
    if (cancelledRef.current) return;

    hasLoadedOnce.current   = false;
    hardRestartCountRef.current = 0;
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

    currentEntryRef.current = next.entry ?? next.url;
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

  // ── Content load — extracted so it can run both on channel change AND ────
  // ── right after streamRestartKey bumps for a mid-roll ────────────────────

  const loadChannel = useCallback(async () => {
    const myGen = ++loadGenRef.current;
    const ch = channelRef.current;

    clearAllTimers();
    hasLoadedOnce.current        = false;
    hardRestartCountRef.current  = 0;
    currentEntryRef.current      = null;
    sourceIndexRef.current       = 0;
    triedInCycleRef.current      = 0;
    healthRef.current            = {};

    sortedUrlsRef.current   = ch.streamUrls ?? [];
    totalSourcesRef.current = sortedUrlsRef.current.length;

    setMode('content');
    setStream(null);
    setSpinner(RESOLVING);
    setStreamRestartKey(0);

    console.log(`[VideoPlayer] ── "${ch.name}" | ${totalSourcesRef.current} source(s)`);

    const health = await StreamHealthService.fetchHealth(ch.id);
    if (cancelledRef.current || loadGenRef.current !== myGen) return;

    healthRef.current       = health;
    const sorted            = StreamHealthService.sort(ch.streamUrls ?? [], health);
    sortedUrlsRef.current   = sorted;
    totalSourcesRef.current = sorted.length;

    const deadCount = sorted.filter(e => health[e.url]?.isDead).length;
    if (deadCount > 0) {
      console.log(
        `[VideoPlayer] 💀 ${deadCount}/${sorted.length} sources marked dead — sorted to back`,
      );
    }

    if (cancelledRef.current || loadGenRef.current !== myGen) return;

    const firstEntry = sorted[0] ?? ch.streamUrl;

    let resolved: ResolvedStream | null = null;
    try {
      resolved = await StreamResolver.resolve(firstEntry);
      sourceIndexRef.current  = 1;
      triedInCycleRef.current = 1;
    } catch (e: any) {
      console.error('[VideoPlayer] Initial resolve error:', e?.message ?? e);
    }

    if (cancelledRef.current || loadGenRef.current !== myGen) return;

    if (resolved) {
      console.log(`[VideoPlayer] ✅ Initial → ${resolved.type}: ${resolved.url}`);
      currentEntryRef.current = firstEntry;
      setStream(resolved);
      setSpinner(LOADING);
    } else {
      reconnectRef.current(true);
    }
  }, [clearAllTimers]);

  useEffect(() => { loadChannelRef.current = loadChannel; }, [loadChannel]);

  // ── Ad-break scheduling ───────────────────────────────────────────────────
  //
  // Armed after every successful content first-frame; fires a mid-roll ad
  // break once the configured interval elapses, as long as we're still
  // playing content, the app is foregrounded, and AdService says it's time.
  // Since there's no imperative "request ad now" API, triggering the ad
  // means bumping streamRestartKey to force a fresh <Video> mount with
  // adTagUrl attached.
  const scheduleMidRoll = useCallback(() => {
    clearMidRollTimer();
    midRollTimerRef.current = setTimeout(function tick() {
      if (cancelledRef.current) return;
      if (modeRef.current === 'content' && appActiveRef.current && AdService.canPlayMidRoll()) {
        console.log('[VideoPlayer] 🅱️ Triggering mid-roll ad');
        setAdTagUrl(VAST_AD_TAG_URL);
        setStreamRestartKey(k => k + 1); // forces IMA to issue a fresh ad request
      } else {
        midRollTimerRef.current = setTimeout(tick, 30_000);
      }
    }, AdService.midRollIntervalMs());
  }, [clearMidRollTimer]);

  // ── IMA ad events ──────────────────────────────────────────────────────────

  const handleAdEvent = useCallback<AdEventHandler>((event: AdEvent) => {
    if (cancelledRef.current) return;
    const type = event?.event;
    if (!type) return;

    if (type === 'AD_PROGRESS') {
      // Android-only: gives us a real countdown while one's available.
      // `data` is typed as a bare `object`, so read through an `any` cast.
      const data        = event.data as { currentTime?: number; duration?: number } | undefined;
      const currentTime = data?.currentTime;
      const duration    = data?.duration;
      if (typeof duration === 'number' && duration > 0) {
        setAdRemaining(Math.max(0, Math.ceil(duration - (currentTime ?? 0))));
      }
      return;
    }

    if (AD_START_EVENTS.has(type)) {
      if (modeRef.current !== 'ad') {
        console.log('[VideoPlayer] 🅰️ Ad break started:', type);
        setMode('ad');
        setSpinner(HIDDEN); // IMA renders its own ad UI/controls
      }
      return;
    }

    if (AD_END_EVENTS.has(type) || AD_ERROR_EVENTS.has(type)) {
      if (modeRef.current !== 'ad') return; // already resumed — ignore duplicate events
      console.log('[VideoPlayer]', AD_ERROR_EVENTS.has(type) ? '❌ Ad error:' : '✅ Ad break ended:', type);
      AdService.markAdShown();
      setAdTagUrl(undefined);
      setAdRemaining(0);
      setMode('content');
      scheduleMidRoll();
      return;
    }
  }, [scheduleMidRoll]);

  // ── Stall watchdog (content only — IMA manages its own ad timeouts) ──────

  const startStallWatchdog = useCallback(() => {
    if (!hasLoadedOnce.current) return;
    clearStallTimer();
    stallTimerRef.current = setTimeout(() => {
      if (cancelledRef.current || modeRef.current === 'ad') return;

      const stalledUrl = streamRef.current?.url ?? '';
      const ch         = channelRef.current;
      console.warn(`[VideoPlayer] ⚠️ Stall ${STALL_TIMEOUT_MS / 1_000}s — switching source`);

      if (stalledUrl) {
        StreamHealthService.report(ch.id, stalledUrl, 'stall', STALL_TIMEOUT_MS);
      }

      reconnectRef.current(false);
    }, STALL_TIMEOUT_MS);
  }, [clearStallTimer]);

  // ── Initial load / channel change ─────────────────────────────────────────

  useEffect(() => {
    if (!channel?.streamUrl && !channel?.streamUrls?.length) return;

    cancelledRef.current = true;
    clearAllTimers();
    clearMidRollTimer();

    cancelledRef.current = false;
    setContainerReady(false);

    // Decide up front whether this channel load should carry a pre-roll.
    // If so, IMA plays it before content starts since both are attached to
    // the same <Video> element. Logged unconditionally (not just on true) —
    // a silent "false" here is exactly what hid the lastAdAt cooldown bug.
    const wantsPreroll = AdService.shouldPlayOnChannelChange();
    console.log(
      `[VideoPlayer] 🅰️ Pre-roll decision for "${channel.name}": ` +
      (wantsPreroll ? 'PLAY AD ✅' : 'skip ❌ (see [AdService] logs above for why)'),
    );
    setAdTagUrl(wantsPreroll ? VAST_AD_TAG_URL : undefined);

    loadChannelRef.current();

    return () => {
      cancelledRef.current  = true;
      hasLoadedOnce.current = false;
      clearAllTimers();
      clearMidRollTimer();
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
    if (cancelledRef.current || modeRef.current === 'ad') return;
    clearAllTimers();
    hasLoadedOnce.current = true;

    triedInCycleRef.current     = 0;
    hardRestartCountRef.current = 0;
    setSpinner(HIDDEN);

    const url = streamRef.current?.url ?? '';
    const ch  = channelRef.current;
    console.log(`[VideoPlayer] ▶️ Playing "${ch.name}"`);

    if (url) StreamHealthService.report(ch.id, url, 'success');

    // Content is stable — arm the next mid-roll.
    scheduleMidRoll();
  }, [clearAllTimers, scheduleMidRoll]);

  const handleBuffer = useCallback(({ isBuffering }: { isBuffering: boolean }) => {
    if (cancelledRef.current || modeRef.current === 'ad') return; // IMA manages ad buffering itself
    if (!isBuffering) {
      clearStallTimer();
      setSpinner(HIDDEN);
      return;
    }
    setSpinner(BUFFERING);
    startStallWatchdog();
  }, [clearStallTimer, startStallWatchdog]);

  // Live channels don't have a natural end. If this fires while playing
  // content it likely means the underlying stream terminated — let the
  // normal reconnect path handle it. Ad-break completion is handled
  // entirely through onReceiveAdEvent now, not onEnd.
  const handleEnd = useCallback(() => {
    if (cancelledRef.current || modeRef.current === 'ad') return;
    console.warn('[VideoPlayer] ⚠️ Unexpected onEnd for live content — reconnecting');
    reconnectRef.current(true);
  }, []);

  // ── handleError ────────────────────────────────────────────────────────────

  const handleError = useCallback((err: any) => {
    if (cancelledRef.current) return;

    const code   = err?.error?.errorCode   as number | undefined;
    const msg    = err?.error?.errorString as string | undefined;
    const domain = err?.error?.domain      as string | undefined;

    clearAllTimers();

    // IMA manages its own ad error recovery (fires AD_ERROR via
    // onReceiveAdEvent, which handleAdEvent already handles) — don't let our
    // live-stream failover machinery (hard restart / source cycling) run
    // while an ad is on screen.
    if (modeRef.current === 'ad') {
      console.warn(`[VideoPlayer] Player error during ad break | code=${code ?? 'n/a'} | ${msg ?? 'n/a'} — deferring to IMA`);
      return;
    }

    const ch  = channelRef.current;
    const stm = streamRef.current;

    console.error(`[VideoPlayer] ❌ ExoPlayer | code=${code ?? 'n/a'} | ${msg ?? 'n/a'}`);

    // ── Special case: seek to live edge ───────────────────────────────────
    if (code === EXO_BEHIND_LIVE_WINDOW) {
      setSpinner({ ...LOADING, label: 'Catching up to live…' });
      seekToLiveEdge();
      return;
    }

    // ── Mid-stream 22004 → attempt hard restart first ─────────────────────
    if (
      code === EXO_BAD_HTTP_STATUS &&
      hasLoadedOnce.current &&
      hardRestartCountRef.current < MAX_HARD_RESTARTS
    ) {
      console.warn(
        `[VideoPlayer] ⚡ Mid-stream 22004 — attempting hard restart ` +
        `(${hardRestartCountRef.current + 1}/${MAX_HARD_RESTARTS})`,
      );
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

  // `type: 'csai'` is a required discriminant on this version's AdConfig
  // union (Client-Side Ad Insertion) — omitting it is what threw the
  // "Property 'type' is missing" TS error.
  const videoSource = useMemo<VideoSourceProp>(() => {
    if (!stream) return undefined;
    const base = { uri: stream.url, type: stream.type, headers: sourceHeaders };
    return adTagUrl ? { ...base, ad: { type: 'csai' as const, adTagUrl } } : base;
  }, [stream, sourceHeaders, adTagUrl]);

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
      `[VideoPlayer] 📺 → mode=${mode} type=${stream.type} drm=${drmProp?.type ?? 'none'} url=${stream.url} ad=${adTagUrl ? 'yes' : 'no'}`,
    );
    if (videoSource && 'ad' in (videoSource as any)) {
      console.log('[VideoPlayer] 🎬 <Video> source carries ad config:', JSON.stringify((videoSource as any).ad));
    } else if (adTagUrl) {
      // adTagUrl state is set but didn't make it into videoSource — a real
      // wiring bug, distinct from the AdService cooldown bug.
      console.warn('[VideoPlayer] ⚠️ adTagUrl is set but videoSource has no `ad` field — check the videoSource memo');
    }
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
      {stream && containerReady && videoSource && (
        <View style={[styles.videoWrapper, { pointerEvents: 'none' }]}>
        <Video
  key={`${stream.url}-${streamRestartKey}`}
  ref={videoRef}
  source={videoSource}
  onReceiveAdEvent={handleAdEvent}
  style={styles.video}
  resizeMode="contain"
  bufferConfig={BUFFER_CONFIG}
  paused={!appActive || paused}  
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
  onBuffer={handleBuffer}
  onEnd={handleEnd}
  focusable={false}
  viewType={ViewType.TEXTURE}
  {...(drmProp ? { drm: drmProp } : {})}
  {...(Platform.isTV ? { isTVSelectable: false } : {})}
/>
        </View>
      )}

      {mode === 'ad' && !spinner.visible && (
        <View style={styles.adBadge} pointerEvents="none">
          <Text style={styles.adBadgeText}>
            {adRemaining > 0 ? `Ad · ${formatCountdown(adRemaining)}` : 'Ad'}
          </Text>
        </View>
      )}

      {spinner.visible && (
        <View style={styles.overlay}>
          <ActivityIndicator size="large" color="#3b82f6" />
          <Text style={styles.overlayLabel}>{spinner.label}</Text>
          <Text style={styles.overlayChannel}>{mode === 'ad' ? 'Advertisement' : channel.name}</Text>

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

const VideoPlayer: React.FC<Props> = ({ channel, fullscreen, paused, onFullscreenDismiss }) => {
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
        paused={paused}
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
  adBadge: {
    position: 'absolute',
    top: 16,
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  adBadgeText: { color: '#fff', fontSize: 12, fontWeight: '600', letterSpacing: 0.5 },
});

export default VideoPlayer;