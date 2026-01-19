import React from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { useChannelContext } from '../../context/ChannelContext';
import { CATEGORIES, LANGUAGES } from '../../constants/channels';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

const ChannelFilters: React.FC = () => {
  const { filter, setFilter } = useChannelContext();

  return (
    <View style={styles.container}>
      <View style={styles.pickerContainer}>
        <Icon name="shape" size={14} color="#9ca3af" style={styles.icon} />
        <Picker
          selectedValue={filter.category}
          onValueChange={(value) => setFilter({ ...filter, category: value })}
          style={styles.picker}
          dropdownIconColor="#9ca3af"
          mode="dropdown"
        >
          {CATEGORIES.map((cat) => (
            <Picker.Item 
              key={cat} 
              label={`📺 ${cat}`} 
              value={cat}
              color={Platform.OS === 'ios' ? '#fff' : '#fff'}
            />
          ))}
        </Picker>
      </View>

      <View style={styles.pickerContainer}>
        <Icon name="web" size={14} color="#9ca3af" style={styles.icon} />
        <Picker
          selectedValue={filter.language}
          onValueChange={(value) => setFilter({ ...filter, language: value })}
          style={styles.picker}
          dropdownIconColor="#9ca3af"
          mode="dropdown"
        >
          {LANGUAGES.map((lang) => (
            <Picker.Item 
              key={lang} 
              label={`🌐 ${lang}`} 
              value={lang}
              color={Platform.OS === 'ios' ? '#fff' : '#fff'}
            />
          ))}
        </Picker>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
  },
  pickerContainer: {
    flex: 1,
    backgroundColor: 'rgba(55, 65, 81, 0.8)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#374151',
    position: 'relative',
    overflow: 'hidden',
  },
  icon: {
    position: 'absolute',
    left: 12,
    top: Platform.OS === 'ios' ? 12 : 16,
    zIndex: 1,
  },
  picker: {
    color: '#fff',
    backgroundColor: 'transparent',
    paddingLeft: 36,
    height: Platform.OS === 'ios' ? 120 : 50,
  },
});

export default ChannelFilters;