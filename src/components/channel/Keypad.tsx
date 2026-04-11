// src/components/channel/Keypad.tsx
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { APP_CONFIG } from '../../constants/config';

interface Props {
  onChannelSelect: (channelNumber: number) => void;
  // Called on every key press so the parent can reset the hide timer
  onActivity?: () => void;
}

interface KeyButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'normal' | 'go' | 'back';
  isFirst?: boolean;
}

// Each key is extracted so it can track its own focus state for TV
const KeyButton: React.FC<KeyButtonProps> = ({ label, onPress, variant = 'normal', isFirst }) => {
  const [focused, setFocused] = useState(false);
  const isTV = Platform.isTV;

  return (
    <TouchableOpacity
      style={[
        styles.key,
        variant === 'go' && styles.keyGo,
        variant === 'back' && styles.keyBack,
        focused && styles.keyFocused,
      ]}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      activeOpacity={0.7}
      hasTVPreferredFocus={isFirst && isTV}
      accessibilityLabel={label === 'BACK' ? 'Backspace' : label === 'GO' ? 'Go to channel' : `Digit ${label}`}
      accessibilityRole="button"
    >
      {label === 'BACK' ? (
        <Icon
          name="backspace-outline"
          size={isTV ? 28 : 22}
          color={focused ? '#fff' : '#e5e7eb'}
        />
      ) : (
        <Text style={[styles.keyText, focused && styles.keyTextFocused, isTV && styles.tvKeyText]}>
          {label}
        </Text>
      )}
    </TouchableOpacity>
  );
};

// ─── Keypad ───────────────────────────────────────────────────────────────────
const Keypad: React.FC<Props> = ({ onChannelSelect, onActivity }) => {
  const [input, setInput] = useState('');
  const isTV = Platform.isTV;

  const handleKeyPress = (key: string) => {
    onActivity?.(); // every key press resets the menu hide timer
    if (key === 'BACK') {
      setInput(prev => prev.slice(0, -1));
    } else if (key === 'GO') {
      if (input) {
        const channelNum = parseInt(input, 10);
        if (channelNum >= 1) onChannelSelect(channelNum);
        setInput('');
      }
    } else {
      if (input.length < 3) setInput(prev => prev + key);
    }
  };

  const keys: string[][] = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    ['BACK', '0', 'GO'],
  ];

  return (
    <View style={[styles.container, isTV && styles.tvContainer]}>
      {/* Header */}
      <View style={styles.header}>
        <Icon name="magnify" size={14} color="#fff" />
        <Text style={[styles.headerText, isTV && styles.tvHeaderText]}>Quick Jump</Text>
      </View>

      {/* Display */}
      <View style={styles.display}>
        <Text style={[styles.displayText, isTV && styles.tvDisplayText]}>
          {input || '---'}
        </Text>
      </View>

      {/* Keys */}
      <View style={styles.keypadGrid}>
        {keys.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.row}>
            {row.map((key, colIndex) => (
              <KeyButton
                key={key}
                label={key}
                onPress={() => handleKeyPress(key)}
                variant={key === 'GO' ? 'go' : key === 'BACK' ? 'back' : 'normal'}
                // First key gets focus when TV focus enters keypad
                isFirst={rowIndex === 0 && colIndex === 0}
              />
            ))}
          </View>
        ))}
      </View>

      <Text style={styles.hint}>Enter channel number</Text>
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1f2937',
    overflow: 'hidden',
  },
  tvContainer: {
    borderRadius: 18,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    backgroundColor: 'rgba(124,58,237,0.2)',
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
  },
  headerText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: 'bold',
    marginLeft: 6,
  },
  tvHeaderText: {
    fontSize: 18,
  },

  display: {
    backgroundColor: 'rgba(17,24,39,0.8)',
    padding: 10,
    margin: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#374151',
  },
  displayText: {
    color: '#fff',
    fontSize: 22,
    fontWeight: 'bold',
    textAlign: 'center',
    letterSpacing: 6,
  },
  tvDisplayText: {
    fontSize: 32,
  },

keypadGrid: {
  padding: 12,
},
row: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  marginBottom: 8,
},

  // ── Key button ───────────────────────────────────────────────────────────────
 key: {
  flex: 1,
  marginHorizontal: 4, // 👈 spacing
  paddingVertical: 14, // 👈 bigger buttons
  borderRadius: 10,
},
  keyGo: {
    backgroundColor: '#16a34a',
  },
  keyBack: {
    backgroundColor: 'rgba(239,68,68,0.8)',
  },
  // TV focus ring — bright white border, user never loses their position
 keyFocused: {
  borderColor: '#ff3b30', // 🔴 RED (your requirement)
  backgroundColor: 'rgba(255,59,48,0.2)',
  transform: [{ scale: 1.05 }],
},
  keyText: {
    color: '#e5e7eb',
    fontSize: 18,
    fontWeight: 'bold',
  },
  tvKeyText: {
    fontSize: 26,
  },
  keyTextFocused: {
    color: '#fff',
  },

  hint: {
    color: '#6b7280',
    fontSize: 10,
    textAlign: 'center',
    paddingBottom: 10,
  },
});

export default Keypad;