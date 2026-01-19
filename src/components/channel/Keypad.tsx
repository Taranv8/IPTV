import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { APP_CONFIG } from '../../constants/config';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface Props {
  onChannelSelect: (channelNumber: number) => void;
}

const Keypad: React.FC<Props> = ({ onChannelSelect }) => {
  const [input, setInput] = useState('');

  const handleKeyPress = (key: string) => {
    if (key === 'BACK') {
      setInput(input.slice(0, -1));
    } else if (key === 'GO') {
      if (input) {
        const channelNum = parseInt(input);
        if (channelNum >= APP_CONFIG.MIN_CHANNEL_NUMBER && 
            channelNum <= APP_CONFIG.MAX_CHANNEL_NUMBER) {
          onChannelSelect(channelNum);
        }
        setInput('');
      }
    } else {
      if (input.length < 3) {
        setInput(input + key);
      }
    }
  };

  const keys = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    ['BACK', '0', 'GO'],
  ];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Icon name="magnify" size={16} color="#fff" />
        <Text style={styles.headerText}>Quick Jump</Text>
      </View>

      <View style={styles.display}>
        <Text style={styles.displayText}>{input || '---'}</Text>
      </View>

      <View style={styles.keypadGrid}>
        {keys.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.row}>
            {row.map((key) => (
              <TouchableOpacity
                key={key}
                style={[
                  styles.key,
                  key === 'GO' && styles.keyGo,
                  key === 'BACK' && styles.keyBack,
                ]}
                onPress={() => handleKeyPress(key)}
                activeOpacity={0.7}
              >
                {key === 'BACK' ? (
                  <Icon name="backspace-outline" size={24} color="#fff" />
                ) : (
                  <Text style={styles.keyText}>{key}</Text>
                )}
              </TouchableOpacity>
            ))}
          </View>
        ))}
      </View>

      <Text style={styles.hint}>Enter channel number</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: 'rgba(124, 58, 237, 0.2)',
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
  },
  headerText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  display: {
    backgroundColor: 'rgba(17, 24, 39, 0.8)',
    padding: 12,
    margin: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#374151',
  },
  displayText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    letterSpacing: 4,
  },
  keypadGrid: {
    padding: 12,
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  key: {
    flex: 1,
    backgroundColor: 'rgba(55, 65, 81, 0.8)',
    paddingVertical: 12,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  keyGo: {
    backgroundColor: '#16a34a',
  },
  keyBack: {
    backgroundColor: 'rgba(239, 68, 68, 0.8)',
  },
  keyText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  hint: {
    color: '#6b7280',
    fontSize: 10,
    textAlign: 'center',
    paddingBottom: 12,
  },
});

export default Keypad;