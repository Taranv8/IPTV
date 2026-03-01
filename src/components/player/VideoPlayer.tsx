// components/player/VideoPlayer.tsx
import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Text,
  TouchableOpacity,
} from 'react-native';
import Video, { OnLoadData } from 'react-native-video';
import { Channel } from '../../types/channel';
import { StreamResolver, ResolvedStream } from '../../services/stream/StreamResolver';

async function safeReport(message: string, code: string, extras: Record<string, any>): Promise<void> {
  try {
    const mod = require('../../services/error/ErrorReporter');
    const reporter = mod?.ErrorReporter ?? mod?.default;
    if (reporter && typeof reporter.report === 'function') {
      await reporter.report(new Error(message), code, extras);
    }
  } catch (e) {
    console.warn('[VideoPlayer] ErrorReporter threw, ignoring:', e);
  }
}

interface Props {
  channel: Channel;
}

const VideoPlayer: React.FC<Props> = ({ channel }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<ResolvedStream | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const videoRef = useRef<any>(null);

  // ─── Resolve stream URL + type whenever channel changes ──────────────────────
  useEffect(() => {
    let cancelled = false;

    setStream(null);
    setIsLoading(true);
    setError(null);
    setRetryCount(0);

    (async () => {
      try {
        const resolved = await StreamResolver.resolve(channel.url);
        if (!cancelled) {
          console.log(`[VideoPlayer] Playing ${resolved.type} stream:`, resolved.url);
          setStream(resolved);
        }
      } catch (e) {
        if (!cancelled) {
          console.error('[VideoPlayer] URL resolution threw:', e);
          setError('Failed to resolve stream URL');
          setIsLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [channel.url]);

  // ─── Video event handlers ─────────────────────────────────────────────────────
  const handleLoadStart = () => {
    setIsLoading(true);
    setError(null);
  };

  const handleLoad = (_data: OnLoadData) => {
    setIsLoading(false);
  };

  const handleBuffer = ({ isBuffering }: { isBuffering: boolean }) => {
    setIsLoading(isBuffering);
  };

  const handleError = (err: any) => {
    setIsLoading(false);

    const exoError = err?.error?.errorCode;
    const exoMsg = err?.error?.errorString;
    console.error('[VideoPlayer] Playback error:', exoError, exoMsg);

    // Auto-retry once: fall back to original URL with m3u8 assumption
    if (retryCount === 0 && stream?.url !== channel.url) {
      console.warn('[VideoPlayer] Retrying with original URL as m3u8');
      setRetryCount(1);
      setStream({ url: channel.url, type: 'm3u8' });
      setIsLoading(true);
      return;
    }

    // Auto-retry twice: if m3u8 failed, try mpd (some streams are DASH)
    if (retryCount === 1 && stream?.type === 'm3u8') {
      console.warn('[VideoPlayer] Retrying as DASH/MPD');
      setRetryCount(2);
      setStream({ url: channel.url, type: 'mpd' });
      setIsLoading(true);
      return;
    }

    setError('Channel unavailable');
    safeReport('Video playback error', 'PLAYBACK_ERROR', {
      channelNumber: channel.number,
      channelName: channel.name,
      originalUrl: channel.url,
      resolvedUrl: stream?.url,
      resolvedType: stream?.type,
      exoError,
      exoMsg,
    });
  };

  // ─── Manual retry ─────────────────────────────────────────────────────────────
  const handleRetry = async () => {
    setError(null);
    setStream(null);
    setIsLoading(true);
    setRetryCount(0);
    try {
      const resolved = await StreamResolver.resolve(channel.url);
      setStream(resolved);
    } catch {
      setError('Failed to resolve stream URL');
      setIsLoading(false);
    }
  };

  // ─── Error state ──────────────────────────────────────────────────────────────
  if (error) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorIcon}>📺</Text>
        <Text style={styles.errorText}>Channel unavailable</Text>
        <Text style={styles.errorSubtext}>{channel.name}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={handleRetry} activeOpacity={0.8}>
          <Text style={styles.retryButtonText}>↺  Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ─── Main render ──────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      {stream ? (
        <Video
          ref={videoRef}
          source={{
            uri: stream.url,
            // ✅ Explicit type prevents ExoPlayer from guessing wrong extractor
            // m3u8 → HLS extractor, mpd → DASH extractor, etc.
            type: stream.type,
            headers: {
              'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18',
              'Accept': 'application/x-mpegURL, application/vnd.apple.mpegurl, audio/mpegurl, application/dash+xml, */*',
            },
          }}
          style={styles.video}
          resizeMode="contain"
          onLoadStart={handleLoadStart}
          onLoad={handleLoad}
          onError={handleError}
          onBuffer={handleBuffer}
          repeat={false}
          playInBackground={false}
          playWhenInactive={false}
          ignoreSilentSwitch="ignore"
          minLoadRetryCount={3}
          reportBandwidth={false}
        />
      ) : null}

      {isLoading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#3b82f6" />
          <Text style={styles.loadingText}>
            {stream ? 'Loading channel...' : 'Resolving stream...'}
          </Text>
          <Text style={styles.loadingSubtext}>{channel.name}</Text>
        </View>
      )}
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  video: { flex: 1 },
  loadingContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.75)',
  },
  loadingText: { color: '#fff', marginTop: 14, fontSize: 16, fontWeight: '500' },
  loadingSubtext: { color: '#9ca3af', marginTop: 6, fontSize: 13 },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0f0f0f',
    paddingHorizontal: 32,
  },
  errorIcon: { fontSize: 56, marginBottom: 16 },
  errorText: { color: '#ef4444', fontSize: 18, fontWeight: 'bold', marginBottom: 6 },
  errorSubtext: { color: '#6b7280', fontSize: 14, marginBottom: 24, textAlign: 'center' },
  retryButton: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 28,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});

export default VideoPlayer;