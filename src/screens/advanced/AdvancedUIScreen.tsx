import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../types/navigation';
import { useChannelContext } from '../../context/ChannelContext';
import { APP_CONFIG } from '../../constants/config';
import ChannelGrid from '../../components/channel/ChannelGrid';
import ChannelFilters from '../../components/channel/ChannelFilters';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

type AdvancedUIScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'AdvancedUI'>;

interface Props {
  navigation: AdvancedUIScreenNavigationProp;
}

const AdvancedUIScreen: React.FC<Props> = ({ navigation }) => {
  const { filteredChannels } = useChannelContext();
const channelCount = filteredChannels.length;

  const handleChannelSelect = useCallback((channelNumber: number) => {
  navigation.navigate('SimpleUI', { channel: channelNumber });
}, [navigation]);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <View style={styles.headerLeft}>
            <View style={styles.logoContainer}>
              <Icon name="grid" size={24} color="#fff" />
            </View>
            <View>
              <Text style={styles.appName}>{APP_CONFIG.APP_NAME}</Text>
              <Text style={styles.modeName}>Advanced Taran   ------------Mode</Text>
            </View>
          </View>

          <View style={styles.headerRight}>
            <View style={styles.totalChannels}>
              <Text style={styles.totalChannelsLabel}>Total Channels</Text>
<Text style={styles.totalChannelsValue}>{channelCount}</Text>
            </View>
            <TouchableOpacity
              style={styles.settingsButton}
              onPress={() => navigation.navigate('Selection')}
            >
              <Icon name="cog" size={16} color="#fff" />
              <Text style={styles.settingsText}>Settings</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Filters */}
        <ChannelFilters />
      </View>

      {/* Channel Grid */}
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <ChannelGrid onChannelSelect={handleChannelSelect} />
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
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
    paddingTop: 16,
    paddingBottom: 16,
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoContainer: {
    backgroundColor: '#7c3aed',
    padding: 10,
    borderRadius: 12,
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
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  totalChannels: {
    backgroundColor: 'rgba(55, 65, 81, 0.5)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#374151',
    marginRight: 12,
  },
  totalChannelsLabel: {
    fontSize: 12,
    color: '#9ca3af',
  },
  totalChannelsValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  settingsButton: {
    backgroundColor: '#374151',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#4b5563',
  },
  settingsText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 8,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
  },
});

export default AdvancedUIScreen;