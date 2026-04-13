import React, { useMemo, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Animated } from 'react-native';
import { useTheme, ThemeColors } from '../context/ThemeContext';

export interface ActionButtonPayload {
  id: string;
  label: string;
  style: 'primary' | 'secondary' | 'danger';
}

interface ActionButtonsProps {
  actions: ActionButtonPayload[];
  onAction: (action: string) => void;
}

export default function ActionButtons({ actions, onAction }: ActionButtonsProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const slideAnim = useRef(new Animated.Value(50)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (actions.length > 0) {
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 0,
          useNativeDriver: true,
          tension: 40,
          friction: 7,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        })
      ]).start();
    } else {
      slideAnim.setValue(50);
      opacityAnim.setValue(0);
    }
  }, [actions, slideAnim, opacityAnim]);

  if (actions.length === 0) return null;

  return (
    <Animated.View 
      style={[
        styles.container, 
        { 
          transform: [{ translateY: slideAnim }],
          opacity: opacityAnim
        }
      ]}
    >
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {actions.map((action) => (
          <TouchableOpacity
            key={action.id}
            style={[
              styles.button,
              action.style === 'primary' && styles.primary,
              action.style === 'secondary' && styles.secondary,
              action.style === 'danger' && styles.danger,
            ]}
            onPress={() => onAction(action.id)}
          >
            <Text style={styles.buttonText}>{action.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </Animated.View>
  );
};

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    backgroundColor: colors.inputBackground,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  scrollContent: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8,
  },
  button: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  primary: {
    backgroundColor: colors.accent,
  },
  secondary: {
    backgroundColor: colors.border,
  },
  danger: {
    backgroundColor: '#f44336',
  },
  buttonText: {
    color: colors.background, // Contrast for text on coloured background
    fontSize: 14,
    fontWeight: '600',
  },
});