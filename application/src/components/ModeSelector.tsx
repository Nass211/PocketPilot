import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Mode } from '../types/messages';
import { useTheme, ThemeColors } from '../context/ThemeContext';

interface ModeSelectorProps {
  currentMode: Mode;
  onModeChange: (mode: Mode) => void;
  disabled: boolean;
}

export default function ModeSelector({ currentMode, onModeChange, disabled }: ModeSelectorProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const modes: Mode[] = ['ask', 'agent', 'plan'];

  return (
    <View style={styles.container}>
      {modes.map((mode) => (
        <TouchableOpacity
          key={mode}
          style={[
            styles.button,
            currentMode === mode && styles.buttonActive,
            disabled && styles.buttonDisabled
          ]}
          onPress={() => !disabled && onModeChange(mode)}
          activeOpacity={disabled ? 1 : 0.7}
        >
          <Text style={[styles.text, currentMode === mode && styles.textActive]}>
            {mode.toUpperCase()}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
};

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: colors.inputBackground,
    borderRadius: 8,
    padding: 4,
  },
  button: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 6,
    backgroundColor: 'transparent',
  },
  buttonActive: {
    backgroundColor: colors.accent,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  text: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  textActive: {
    color: colors.background, // Contrast active button text with background color
  },
});
