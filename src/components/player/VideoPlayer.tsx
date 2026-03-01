// components/player/VideoPlayer.tsx
import React, { useState, useRef, useEffect } from 'react';
import { View, StyleSheet, ActivityIndicator, Text, TouchableOpacity } from 'react-native';
import Video, { OnLoadData, OnProgressData } from 'react-native-video';
import { Channel } from '../../types/channel';
import { StreamResolver } from '../../services/stream/StreamResolver';
import { ErrorReporter } from '../../services/error/ErrorReporter';

interface Props {
  channel: Channel;
}

const VideoPlayer: React.FC<Props> = ({ channel }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const videoRef = useRef<any>(null);

  // ─── Resolve URL whenever channel changes ────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    setResolvedUrl(null);
    setIsLoading(true);
    setError(null);
    setRetryCount(0);

    const resolve = async () => {
      try {
        const url = await StreamResolver.resolve(channel.url);
        if (!cancelled) {
          setResolvedUrl(url);
        }
      } catch {
        if (!cancelled) {
          setError('Failed to resolve stream URL');
          setIsLoading(false);
        }
      }
    };

    resolve();

    // Cleanup: ignore result if channel changed while resolving
    return () => {
      cancelled = true;
    };
  }, [channel.url]);

  // ─── Video event handlers ─────────────────────────────────────────────────────
  const handleLoadStart = () => {
    setIsLoading(true);
    setError(null);
  };

  const handleLoad = (_data: OnLoadData) => {
    setIsLoading(false);
    setError(null);
  };

  const handleBuffer = ({ isBuffering }: { isBuffering: boolean }) => {
    setIsLoading(isBuffering);
  };

  const handleError = (err: any) => {
    setIsLoading(false);

    // If we haven't retried yet, try the original URL as fallback
    if (retryCount === 0 && resolvedUrl !== channel.url) {
      console.warn('[VideoPlayer] Resolved URL failed, retrying with original URL');
      setRetryCount(1);
      setResolvedUrl(channel.url);
      setIsLoading(true);
      return;
    }

    setError('Failed to load channel');
    console.error('[VideoPlayer] Playback error:', err);

    ErrorReporter.report(
      new Error('Video playback error'),
      'PLAYBACK_ERROR',
      {
        channelNumber: channel.number,
        channelName: channel.name,
        originalUrl: channel.url,
        resolvedUrl,
        error: err,
      }
    );
  };

  // ─── Retry handler (manual retry button) ─────────────────────────────────────
  const handleRetry = async () => {
    setError(null);
    setIsLoading(true);
    setResolvedUrl(null);
    setRetryCount(0);

    try {
      const url = await StreamResolver.resolve(channel.url);
      setResolvedUrl(url);
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
        <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
          <Text style={styles.retryButtonText}>↺  Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      {/* Only mount <Video> once the URL is resolved */}
      {resolvedUrl ? (
        <Video
          ref={videoRef}
          source={{
            uri: resolvedUrl,
            headers: {
              // Mimic VLC — many IPTV servers check the User-Agent
              'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18',
              'Accept': 'application/x-mpegURL, application/vnd.apple.mpegurl, audio/mpegurl, */*',
            },
          }}
          style={styles.video}
          resizeMode="contain"
          onLoadStart={handleLoadStart}
          onLoad={handleLoad}
          onError={handleError}
          onBuffer={handleBuffer}
          // Stream-specific settings
          repeat={false}
          playInBackground={false}
          playWhenInactive={false}
          ignoreSilentSwitch="ignore"
          // Improves HLS reliability on Android (ExoPlayer)
          minLoadRetryCount={3}
          reportBandwidth={false}
        />
      ) : null}

      {/* Loading overlay — shows both during URL resolution and buffering */}
      {isLoading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#3b82f6" />
          <Text style={styles.loadingText}>
            {resolvedUrl ? 'Loading channel...' : 'Resolving stream...'}
          </Text>
          <Text style={styles.loadingSubtext}>{channel.name}</Text>
        </View>
      )}
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  video: {
    flex: 1,
  },
  // Loading overlay
  loadingContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
  },
  loadingText: {
    color: '#ffffff',
    marginTop: 14,
    fontSize: 16,
    fontWeight: '500',
  },
  loadingSubtext: {
    color: '#9ca3af',
    marginTop: 6,
    fontSize: 13,
  },
  // Error state
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0f0f0f',
    paddingHorizontal: 32,
  },
  errorIcon: {
    fontSize: 56,
    marginBottom: 16,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 6,
  },
  errorSubtext: {
    color: '#6b7280',
    fontSize: 14,
    marginBottom: 24,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 28,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
});

export default VideoPlayer;