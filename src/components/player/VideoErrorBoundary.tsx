// src/components/player/VideoErrorBoundary.tsx
//
// Catches native crashes that bubble up from ExoPlayer / react-native-video
// and renders a recoverable error screen instead of closing the app.

import React, { Component, ReactNode } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface Props {
  children: ReactNode;
  channelName?: string;
  onRetry?: () => void;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class VideoErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error?.message ?? 'Unknown playback error' };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[VideoErrorBoundary] Caught native crash:', error?.message, info?.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, errorMessage: '' });
    this.props.onRetry?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Icon name="television-off" size={64} color="#374151" />
          <Text style={styles.title}>Playback Error</Text>
          <Text style={styles.channel}>{this.props.channelName ?? 'Unknown channel'}</Text>
          <Text style={styles.detail} numberOfLines={3}>
            {this.state.errorMessage}
          </Text>
          <TouchableOpacity style={styles.retryButton} onPress={this.handleRetry}>
            <Icon name="refresh" size={18} color="#fff" />
            <Text style={styles.retryText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0f0f0f',
    padding: 24,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    marginTop: 16,
  },
  channel: {
    fontSize: 14,
    color: '#9ca3af',
    marginTop: 6,
  },
  detail: {
    fontSize: 11,
    color: '#6b7280',
    marginTop: 10,
    textAlign: 'center',
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 24,
    backgroundColor: '#3b82f6',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});