import React, { useMemo, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity, Alert } from 'react-native';
import { ConnectionStatus as ConnectionStatusType, CliStatus } from '../hooks/useWebSocket';
import { useTheme, ThemeColors } from '../context/ThemeContext';

interface ConnectionStatusProps {
  status: ConnectionStatusType;
  cliStatus: CliStatus;
  url?: string;
}

export default function ConnectionStatus({ status, cliStatus, url }: ConnectionStatusProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (status === 'reconnecting') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 0.4,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    }
  }, [status, pulseAnim]);

  const getStatusInfo = () => {
    if (status === 'disconnected') return { color: '#f44336', text: 'Disconnected' };
    if (status === 'connecting' || status === 'authenticating') return { color: '#ff9800', text: 'Connecting...' };
    if (status === 'reconnecting') return { color: '#ff9800', text: 'Reconnecting...' };
    
    if (status === 'connected') {
      if (cliStatus === 'crashed') return { color: '#ff9800', text: 'CLI crashed' };
      return { color: '#4caf50', text: 'Connected' };
    }
    
    return { color: '#9e9e9e', text: 'Unknown' };
  };

  const info = getStatusInfo();
  
  const handlePress = () => {
    Alert.alert(
      "Connection Information", 
      `URL: ${url || 'Unknown'}\nStatus: ${status}\nCLI Status: ${cliStatus}`
    );
  };

  return (
    <TouchableOpacity style={styles.container} onPress={handlePress} activeOpacity={0.7}>
      <Animated.View 
        style={[
          styles.dot, 
          { backgroundColor: info.color },
           status === 'reconnecting' && { opacity: pulseAnim }
        ]} 
      />
      <Text style={styles.text}>{info.text}</Text>
    </TouchableOpacity>
  );
};

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  text: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '500',
  }
});