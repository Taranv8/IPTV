//VideoPlayer.tsx
import React, { useState, useRef } from 'react';
import { View, StyleSheet, ActivityIndicator, Text } from 'react-native';
import Video from 'react-native-video';
import { Channel } from '../../types/channel';
import { ErrorReporter } from '../../services/error/ErrorReporter';

interface Props {
  channel: Channel;
}

const VideoPlayer: React.FC<Props> = ({ channel }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
const videoRef = useRef<any>(null);

  const handleLoadStart = () => {
    setIsLoading(true);
    setError(null);
  };

  const handleLoad = () => {
    setIsLoading(false);
  };

  const handleError = (err: any) => {
    setIsLoading(false);
    setError('Failed to load channel');
    console.error('Video playback error:', err);
    
    ErrorReporter.report(
      new Error('Video playback error'),
      'PLAYBACK_ERROR',
      { channel: channel.number, url: channel.url, error: err }
    );
  };

  const handleBuffer = ({ isBuffering }: { isBuffering: boolean }) => {
    setIsLoading(isBuffering);
  };

  if (error) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>{error}</Text>
        <Text style={styles.errorSubtext}>Please try another channel</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Video
        ref={videoRef}
        source={{ uri: channel.url }}
        style={styles.video}
        resizeMode="contain"
        onLoadStart={handleLoadStart}
        onLoad={handleLoad}
        onError={handleError}
        onBuffer={handleBuffer}
        repeat
        playInBackground={false}
        playWhenInactive={false}
        ignoreSilentSwitch="ignore"
      />
      
      {isLoading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#3b82f6" />
          <Text style={styles.loadingText}>Loading channel...</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  video: {
    flex: 1,
  },
  loadingContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  loadingText: {
    color: '#fff',
    marginTop: 16,
    fontSize: 16,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0f0f0f',
  },
  errorText: {
    color: '#ef4444',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  errorSubtext: {
    color: '#9ca3af',
    fontSize: 14,
  },
});

export default VideoPlayer;