import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Switch,
  TextInput,
  Alert,
} from 'react-native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../../types/navigation';
import { useSettings } from '../../context/SettingsContext';
import { useChannelContext } from '../../context/ChannelContext';
import { APP_CONFIG } from '../../constants/config';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

type SettingsScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Settings'>;

interface Props {
  navigation: SettingsScreenNavigationProp;
}

const SettingsScreen: React.FC<Props> = ({ navigation }) => {
  const { uiMode, setUIMode, autoHideControls, setAutoHideControls } = useSettings();
  const { loadChannelsFromURL } = useChannelContext();
  const [m3uUrl, setM3uUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleLoadM3U = async () => {
    if (!m3uUrl.trim()) {
      Alert.alert('Error', 'Please enter a valid M3U URL');
      return;
    }

    setIsLoading(true);
    try {
      await loadChannelsFromURL(m3uUrl);
      Alert.alert('Success', 'Channels loaded successfully!');
      setM3uUrl('');
    } catch (error) {
      Alert.alert('Error', 'Failed to load channels. Please check the URL and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearData = () => {
    Alert.alert(
      'Clear All Data',
      'Are you sure you want to clear all settings and channel data?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            // Clear logic will be implemented in context
            Alert.alert('Success', 'All data cleared');
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Icon name="arrow-left" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Icon name="cog" size={28} color="#fff" />
          <Text style={styles.headerTitle}>Settings</Text>
        </View>
        <View style={styles.headerRight} />
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* App Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>App Information</Text>
          <View style={styles.card}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>App Name</Text>
              <Text style={styles.infoValue}>{APP_CONFIG.APP_NAME}</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Version</Text>
              <Text style={styles.infoValue}>{APP_CONFIG.VERSION}</Text>
            </View>
          </View>
        </View>

        {/* UI Mode */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>User Interface</Text>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Default UI Mode</Text>
            <View style={styles.uiModeContainer}>
              <TouchableOpacity
                style={[
                  styles.uiModeButton,
                  uiMode === 'simple' && styles.uiModeButtonActive,
                ]}
                onPress={() => setUIMode('simple')}
              >
                <Icon
                  name="television"
                  size={24}
                  color={uiMode === 'simple' ? '#fff' : '#9ca3af'}
                />
                <Text
                  style={[
                    styles.uiModeText,
                    uiMode === 'simple' && styles.uiModeTextActive,
                  ]}
                >
                  Simple UI
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.uiModeButton,
                  uiMode === 'advanced' && styles.uiModeButtonActiveAdvanced,
                ]}
                onPress={() => setUIMode('advanced')}
              >
                <Icon
                  name="grid"
                  size={24}
                  color={uiMode === 'advanced' ? '#fff' : '#9ca3af'}
                />
                <Text
                  style={[
                    styles.uiModeText,
                    uiMode === 'advanced' && styles.uiModeTextActive,
                  ]}
                >
                  Advanced UI
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Playback Settings */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Playback</Text>
          <View style={styles.card}>
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Auto-hide Controls</Text>
                <Text style={styles.settingDescription}>
                  Hide player controls after 5 seconds
                </Text>
              </View>
              <Switch
                value={autoHideControls}
                onValueChange={setAutoHideControls}
                trackColor={{ false: '#374151', true: '#7c3aed' }}
                thumbColor="#fff"
              />
            </View>
          </View>
        </View>

        {/* Channel Source */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Channel Source</Text>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Load M3U Playlist</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter M3U URL or file path"
              placeholderTextColor="#6b7280"
              value={m3uUrl}
              onChangeText={setM3uUrl}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={[styles.loadButton, isLoading && styles.loadButtonDisabled]}
              onPress={handleLoadM3U}
              disabled={isLoading}
            >
              <Icon name="download" size={20} color="#fff" />
              <Text style={styles.loadButtonText}>
                {isLoading ? 'Loading...' : 'Load Channels'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Advanced Settings */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Advanced</Text>
          <View style={styles.card}>
            <TouchableOpacity style={styles.dangerButton} onPress={handleClearData}>
              <Icon name="delete-outline" size={20} color="#ef4444" />
              <Text style={styles.dangerButtonText}>Clear All Data</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* About */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About</Text>
          <View style={styles.card}>
            <Text style={styles.aboutText}>
              {APP_CONFIG.APP_NAME} - Premium IPTV Experience
            </Text>
            <Text style={styles.aboutSubtext}>
              Enjoy seamless streaming with our modern IPTV player
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f0f',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    paddingTop: 48,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
  },
  backButton: {
    padding: 8,
    backgroundColor: '#374151',
    borderRadius: 8,
  },
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  headerRight: {
    width: 40,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#9ca3af',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  card: {
    backgroundColor: '#1f2937',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#374151',
  },
  cardLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#e5e7eb',
    marginBottom: 12,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  infoLabel: {
    fontSize: 14,
    color: '#9ca3af',
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  divider: {
    height: 1,
    backgroundColor: '#374151',
  },
  uiModeContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  uiModeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 16,
    backgroundColor: '#374151',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  uiModeButtonActive: {
    backgroundColor: '#2563eb',
    borderColor: '#3b82f6',
  },
  uiModeButtonActiveAdvanced: {
    backgroundColor: '#7c3aed',
    borderColor: '#8b5cf6',
  },
  uiModeText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9ca3af',
  },
  uiModeTextActive: {
    color: '#fff',
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  settingInfo: {
    flex: 1,
    marginRight: 16,
  },
  settingLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 4,
  },
  settingDescription: {
    fontSize: 12,
    color: '#9ca3af',
  },
  input: {
    backgroundColor: '#374151',
    borderWidth: 1,
    borderColor: '#4b5563',
    borderRadius: 8,
    padding: 12,
    color: '#fff',
    fontSize: 14,
    marginBottom: 12,
  },
  loadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#7c3aed',
    padding: 12,
    borderRadius: 8,
  },
  loadButtonDisabled: {
    opacity: 0.5,
  },
  loadButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  dangerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 12,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ef4444',
  },
  dangerButtonText: {
    color: '#ef4444',
    fontSize: 14,
    fontWeight: '600',
  },
  aboutText: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '600',
    marginBottom: 8,
  },
  aboutSubtext: {
    fontSize: 12,
    color: '#9ca3af',
  },
});

export default SettingsScreen;