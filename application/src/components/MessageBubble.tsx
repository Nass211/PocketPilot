import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import MarkdownRenderer from './MarkdownRenderer';
import { useTheme, ThemeColors } from '../context/ThemeContext';

export default function MessageBubble({ message }: { message: any }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const isUser = message.role === 'user';
  
  if (isUser) {
    return (
      <View style={[styles.bubble, styles.user]}>
        <Text style={styles.textUser}>{message.content}</Text>
      </View>
    );
  }

  // Assistant Bubble
  return (
    <View style={styles.assistantContainer}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>AI</Text>
      </View>
      <View style={[styles.bubble, styles.assistant]}>
        <MarkdownRenderer 
          content={message.content + (message.isStreaming ? ' \u2588' : '')} 
          color={colors.assistantText}
        />
      </View>
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  assistantContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginVertical: 4,
    marginHorizontal: 8,
    maxWidth: '90%',
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.accent || '#10a37f',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
    marginTop: 2,
  },
  avatarText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  bubble: { 
    padding: 12, 
    borderRadius: 12, 
  },
  user: { 
    backgroundColor: colors.userBubble, 
    alignSelf: 'flex-end',
    marginVertical: 4, 
    marginHorizontal: 8,
    maxWidth: '80%',
  },
  assistant: { 
    backgroundColor: colors.assistantBubble,
    alignSelf: 'flex-start',
    flexShrink: 1,
  },
  textUser: { color: colors.background, fontSize: 16 },
});