import React, { useMemo, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, Animated } from 'react-native';
import { useTheme, ThemeColors } from '../context/ThemeContext';

export interface PermissionRequestPayload {
  id: string;
  kind: string;
  command: string;
}

interface PermissionModalProps {
  request: PermissionRequestPayload | null;
  onDecision: (id: string, decision: 'allow' | 'allow_session' | 'allow_all' | 'deny') => void;
}

export default function PermissionModal({ request, onDecision }: PermissionModalProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const scaleValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (request) {
      Animated.spring(scaleValue, {
        toValue: 1,
        useNativeDriver: true,
        friction: 6,
        tension: 40,
      }).start();
    } else {
      scaleValue.setValue(0);
    }
  }, [request, scaleValue]);

  if (!request) return null;

  const getIcon = (kind: string) => {
    const k = kind.toLowerCase();
    if (k.includes('read')) return '📖';
    if (k.includes('write')) return '✏️';
    if (k.includes('execute') || k.includes('run')) return '⚡';
    return '🔒';
  };

  const handleDecision = (decision: 'allow' | 'allow_session' | 'allow_all' | 'deny') => {
    onDecision(request.id, decision);
  };

  return (
    <Modal visible={!!request} transparent animationType="fade">
      <View style={styles.overlay}>
        <Animated.View style={[styles.modalContainer, { transform: [{ scale: scaleValue }] }]}>
          <View style={styles.header}>
            <Text style={styles.icon}>{getIcon(request.kind)}</Text>
            <Text style={styles.title}>{request.kind.toUpperCase()}</Text>
          </View>
          
          <View style={styles.commandContainer}>
            <Text style={styles.commandText}>{request.command}</Text>
          </View>

          <View style={styles.buttonContainer}>
            <TouchableOpacity 
              style={[styles.button, styles.btnAllow]} 
              onPress={() => handleDecision('allow')}
            >
              <Text style={styles.buttonText}>Allow</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.button, styles.btnAllowSession]} 
              onPress={() => handleDecision('allow_session')}
            >
              <Text style={styles.buttonText}>Allow session</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.button, styles.btnAllowAll]} 
              onPress={() => handleDecision('allow_all')}
            >
              <Text style={styles.buttonText}>Allow all</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.button, styles.btnDeny]} 
              onPress={() => handleDecision('deny')}
            >
              <Text style={styles.buttonText}>Deny</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
};

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContainer: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    width: '100%',
    padding: 24,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  icon: {
    fontSize: 24,
    marginRight: 12,
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: 'bold',
  },
  commandContainer: {
    backgroundColor: colors.inputBackground,
    padding: 12,
    borderRadius: 8,
    marginBottom: 24,
  },
  commandText: {
    color: colors.text,
    fontFamily: 'monospace',
    fontSize: 14,
  },
  buttonContainer: {
    gap: 12,
  },
  button: {
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnAllow: {
    backgroundColor: colors.accent,
  },
  btnAllowSession: {
    backgroundColor: '#4caf50',
  },
  btnAllowAll: {
    backgroundColor: '#ff9800',
  },
  btnDeny: {
    backgroundColor: '#f44336',
  },
  buttonText: {
    color: colors.background, // Keep white text visibility using background
    fontSize: 16,
    fontWeight: '600',
  },
});