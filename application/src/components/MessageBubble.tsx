import React, { useMemo, useState } from 'react';
import {
  View, Text, Image, StyleSheet, ActivityIndicator,
  TouchableOpacity, Platform, Modal, SafeAreaView, TouchableWithoutFeedback
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as HapticsModule from 'expo-haptics';
import MarkdownRenderer from './MarkdownRenderer';
import { useTheme, ThemeColors } from '../context/ThemeContext';

interface MessageBubbleProps {
  message: any;
  onEditMessage?: (message: any) => void;
}

export default function MessageBubble({ message, onEditMessage }: MessageBubbleProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const isUser = message.role === 'user';
  const attachments = message.attachments || [];
  const [showActions, setShowActions] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  const handlePress = () => {
    setShowActions(prev => !prev);
  };

  const handleCopy = () => {
    if (message.content) {
      Clipboard.setStringAsync(message.content);
      HapticsModule.notificationAsync(HapticsModule.NotificationFeedbackType.Success);
    }
    setShowActions(false);
  };

  const handleEdit = () => {
    setShowActions(false);
    if (onEditMessage) {
      onEditMessage(message);
    }
  };

  // Action icons row (ChatGPT style — appears below the bubble)
  const actionRow = showActions && message.content ? (
    <View style={[styles.actionsRow, isUser ? styles.actionsRowUser : styles.actionsRowAssistant]}>
      <TouchableOpacity style={styles.actionBtn} onPress={handleCopy} activeOpacity={0.6}>
        <Text style={styles.actionIcon}>❐</Text>
      </TouchableOpacity>
      {isUser && onEditMessage && (
        <TouchableOpacity style={styles.actionBtn} onPress={handleEdit} activeOpacity={0.6}>
          <Text style={styles.actionIcon}>✏️</Text>
        </TouchableOpacity>
      )}
    </View>
  ) : null;

  if (isUser) {
    return (
      <View style={styles.userWrapper}>
        <TouchableOpacity
          onPress={handlePress}
          activeOpacity={0.85}
          style={[styles.bubble, styles.user]}
        >
          {attachments.length > 0 && (
            <View style={styles.attachmentRow}>
              {attachments.map((att: any) => (
                att.type === 'image' ? (
                  <TouchableOpacity key={att.id} onPress={() => setSelectedImage(att.uri)} activeOpacity={0.8} style={styles.imageWrapper}>
                    <Image
                      source={{ uri: att.uri }}
                      style={styles.msgImage}
                      resizeMode="cover"
                    />
                  </TouchableOpacity>
                ) : (
                  <View key={att.id} style={styles.msgFile}>
                    <Text style={styles.msgFileIcon}>
                      {att.mimeType?.includes('pdf') ? '📕' : '📄'}
                    </Text>
                    <Text style={styles.msgFileName} numberOfLines={1}>{att.name}</Text>
                  </View>
                )
              ))}
            </View>
          )}
          {message.content ? (
            <Text style={styles.textUser}>{message.content}</Text>
          ) : null}
        </TouchableOpacity>
        {actionRow}

        {/* Fullscreen Image Preview */}
        <Modal visible={!!selectedImage} transparent={true} animationType="fade">
          <SafeAreaView style={styles.modalBackground}>
            <TouchableOpacity 
              style={styles.modalCloseButton} 
              onPress={() => setSelectedImage(null)}
            >
              <Text style={styles.modalCloseText}>✕</Text>
            </TouchableOpacity>
            <TouchableWithoutFeedback onPress={() => setSelectedImage(null)}>
              <View style={styles.modalContent}>
                {selectedImage && (
                  <Image 
                    source={{ uri: selectedImage }} 
                    style={styles.fullScreenImage} 
                    resizeMode="contain" 
                  />
                )}
              </View>
            </TouchableWithoutFeedback>
          </SafeAreaView>
        </Modal>
      </View>
    );
  }

  // Assistant Bubble
  return (
    <View style={styles.assistantWrapper}>
      <View style={styles.assistantContainer}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>AI</Text>
        </View>
        <TouchableOpacity
          onPress={handlePress}
          activeOpacity={0.85}
          style={[styles.bubble, styles.assistant]}
        >
          {message.content ? (
            <MarkdownRenderer 
              content={message.content} 
              color={colors.assistantText}
            />
          ) : (
            message.isStreaming && (
              <View style={styles.loaderContainer}>
                <ActivityIndicator 
                  size="small" 
                  color={colors.accent || '#ff9500'} 
                />
              </View>
            )
          )}
        </TouchableOpacity>
      </View>
      {actionRow}
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  userWrapper: {
    alignItems: 'flex-end',
  },
  assistantWrapper: {
    alignItems: 'flex-start',
  },
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
  textUser: { color: colors.userText, fontSize: 16 },
  loaderContainer: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  // ── Attachment styles in bubbles ──
  attachmentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  msgImage: {
    width: 180,
    height: 180,
    borderRadius: 10,
    backgroundColor: colors.border || '#333',
  },
  msgFile: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface || '#222',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
  },
  msgFileIcon: {
    fontSize: 20,
  },
  msgFileName: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
    maxWidth: 150,
  },
  // ── ChatGPT-style action icons below bubble ──
  actionsRow: {
    flexDirection: 'row',
    gap: 4,
    marginTop: 2,
    marginBottom: 4,
    paddingHorizontal: 12,
  },
  actionsRowUser: {
    justifyContent: 'flex-end',
  },
  actionsRowAssistant: {
    justifyContent: 'flex-start',
    marginLeft: 40,
  },
  actionBtn: {
    width: 30,
    height: 30,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  actionIcon: {
    fontSize: 14,
    opacity: 0.5,
  },
  imageWrapper: {
    marginRight: 6,
    marginBottom: 6,
  },
  // Fullscreen Modal Styles
  modalBackground: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
  },
  modalCloseButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 20,
    right: 20,
    zIndex: 10,
    padding: 10,
  },
  modalCloseText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
  },
  modalContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullScreenImage: {
    width: '100%',
    height: '100%',
  },
});