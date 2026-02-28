import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Dimensions,
  Pressable,
} from 'react-native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../../types/navigation';
import { useChannelContext } from '../../context/ChannelContext';
import { APP_CONFIG } from '../../constants/config';
import VideoPlayer from '../../components/player/VideoPlayer';
import Keypad from '../../components/channel/Keypad';
import ChannelList from '../../components/channel/ChannelList';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

type SimpleUIScreenNavigationProp = StackNavigationProp<RootStackParamList, 'SimpleUI'>;

interface Props {
  navigation: SimpleUIScreenNavigationProp;
}

const SimpleUIScreen: React.FC<Props> = ({ navigation }) => {
  const { currentChannel, setCurrentChannel, filteredChannels, channels } = useChannelContext();
  const [showControls, setShowControls] = useState(true);
  const [channelPage, setChannelPage] = useState(0);

  useEffect(() => {
    if (showControls) {
      const timer = setTimeout(() => {
        setShowControls(false);
      }, APP_CONFIG.CONTROLS_HIDE_DELAY);
      return () => clearTimeout(timer);
    }
  }, [showControls]);

  const handleChannelChange = (channelNumber: number) => {
    const channel = channels.find(ch => ch.number === channelNumber);
    if (channel) {
      setCurrentChannel(channel);
      setShowControls(true);
    }
  };

  const handleScreenPress = () => {
    setShowControls(true);
  };

  return (
    <Pressable style={styles.container} onPress={handleScreenPress}>
      {/* Video Player Background */}
      <View style={styles.playerContainer}>
        {currentChannel ? (
          <VideoPlayer channel={currentChannel} />
        ) : (
          <View style={styles.placeholderContainer}>
            <Icon name="television" size={120} color="#374151" />
            <Text style={styles.placeholderText}>No Channel Selected</Text>
          </View>
        )}
      </View>

      {/* Controls Overlay */}
      {showControls && (
        <View style={styles.controlsOverlay}>
          {/* Top Bar */}
          <View style={styles.topBar}>
            <View style={styles.topBarLeft}>
              <View style={styles.logoContainer}>
                <Icon name="home" size={24} color="#fff" />
              </View>
              <View>
                <Text style={styles.appName}>{APP_CONFIG.APP_NAME}</Text>
                <Text style={styles.modeName}>Simple-Mode</Text>
              </View>
            </View>

            <View style={styles.topBarRight}>
              <View style={styles.channelInfo}>
                <Text style={styles.channelNumber}>CH {currentChannel?.number}</Text>
                <Text style={styles.channelName}>{currentChannel?.name}</Text>
              </View>
              <TouchableOpacity
                style={styles.settingsButton}
                onPress={() => navigation.navigate('Selection')}
              >
                <Icon name="cog" size={20} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>

          {/* Channel List - Left Side */}
          <View style={styles.channelListContainer}>
            <ChannelList
              channels={filteredChannels}
              currentChannel={currentChannel}
              onChannelSelect={handleChannelChange}
              channelPage={channelPage}
              setChannelPage={setChannelPage}
            />
          </View>

          {/* Keypad - Right Side */}
          <View style={styles.keypadContainer}>
            <Keypad onChannelSelect={handleChannelChange} />
          </View>
        </View>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  playerContainer: {
    flex: 1,
  },
  placeholderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0f0f0f',
  },
  placeholderText: {
    fontSize: 24,
    color: '#6b7280',
    marginTop: 16,
  },
  controlsOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
  },
  topBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoContainer: {
    backgroundColor: '#3b82f6',
    padding: 8,
    borderRadius: 8,
    marginRight: 16,
  },
  appName: {
    fontSize: 20,
    fontWeight: '900',
    color: '#fff',
  },
  modeName: {
    fontSize: 12,
    color: '#9ca3af',
  },
  topBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  channelInfo: {
    alignItems: 'flex-end',
    marginRight: 24,
  },
  channelNumber: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
  },
  channelName: {
    fontSize: 12,
    color: '#9ca3af',
  },
  settingsButton: {
    backgroundColor: 'rgba(55, 65, 81, 0.8)',
    padding: 8,
    borderRadius: 8,
  },
  channelListContainer: {
    position: 'absolute',
    left: 16,
    top: 80,
    bottom: 16,
    width: 320,
  },
  keypadContainer: {
    position: 'absolute',
    right: 16,
    top: 80,
    width: 224,
  },
});

export default SimpleUIScreen;