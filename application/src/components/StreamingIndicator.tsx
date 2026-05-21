import React, { useMemo, useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';
import { useTheme, ThemeColors } from '../context/ThemeContext';

interface StreamingIndicatorProps {
  visible: boolean;
  activity?: string;
}

export default function StreamingIndicator({ visible, activity }: StreamingIndicatorProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    if (!visible) return;

    const animateDot = (anim: Animated.Value, delay: number) => {
      return Animated.sequence([
        Animated.delay(delay),
        Animated.loop(
          Animated.sequence([
            Animated.timing(anim, {
              toValue: -8,
              duration: 300,
              useNativeDriver: true,
            }),
            Animated.timing(anim, {
              toValue: 0,
              duration: 300,
              useNativeDriver: true,
            }),
            Animated.delay(600),
          ])
        ),
      ]);
    };

    // Pulsing glow for the activity indicator
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.4,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );

    Animated.parallel([
      animateDot(dot1, 0),
      animateDot(dot2, 200),
      animateDot(dot3, 400),
      pulse,
    ]).start();

    return () => {
      dot1.stopAnimation();
      dot2.stopAnimation();
      dot3.stopAnimation();
      pulseAnim.stopAnimation();
    };
  }, [visible, dot1, dot2, dot3, pulseAnim]);

  if (!visible) return null;

  const label = activity || 'Copilot is thinking';

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.activityDot, { opacity: pulseAnim }]} />
      <Text style={styles.text} numberOfLines={1}>{label}</Text>
      <View style={styles.dotsRow}>
        <Animated.View style={[styles.dot, { transform: [{ translateY: dot1 }] }]} />
        <Animated.View style={[styles.dot, { transform: [{ translateY: dot2 }] }]} />
        <Animated.View style={[styles.dot, { transform: [{ translateY: dot3 }] }]} />
      </View>
    </View>
  );
};

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  activityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#58a6ff',
    marginRight: 8,
  },
  text: {
    color: colors.textSecondary,
    fontSize: 13,
    fontStyle: 'italic',
    marginRight: 8,
    flex: 1,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 12,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.textSecondary,
    marginHorizontal: 2,
  },
});