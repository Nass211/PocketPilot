import React from 'react';
import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { 
  View, Text, TextInput, TouchableOpacity, FlatList, Image,
  StyleSheet, KeyboardAvoidingView, Platform, Alert, Animated, ScrollView
} from 'react-native';
import { useAppContext } from '../context/AppContext';
import { useChat } from '../hooks/useChat';
import { useTheme, ThemeColors } from '../context/ThemeContext';
import MessageBubble from '../components/MessageBubble';
import ModeSelector from '../components/ModeSelector';
import ModelSelector from '../components/ModelSelector';
import StreamingIndicator from '../components/StreamingIndicator';
import ConnectionStatus from '../components/ConnectionStatus';
import PermissionModal, { PermissionRequestPayload } from '../components/PermissionModal';
import UserInputModal, { UserInputRequestPayload } from '../components/UserInputModal';
import ActionButtons, { ActionButtonPayload } from '../components/ActionButtons';
import { FilesModifiedSummary } from '../components/DiffViewer';
import { Mode, MessageAttachment } from '../types/messages';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Audio } from 'expo-av';
import Logo from '../components/Logo';
import { transcribeAudio } from '../services/groqService';

export default function ChatScreen({ navigation, route }: any) {
  const ws = useAppContext();
  const { colors, theme, toggleTheme } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [input, setInput] = useState('');
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [voiceState, setVoiceState] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const [currentMode, setCurrentMode] = useState<Mode>('ask');
  const [currentModel, setCurrentModel] = useState<string>('auto');
  const [overrideModel, setOverrideModel] = useState<boolean>(false);
  const flatListRef = useRef<FlatList>(null);

  // States for modals
  const [permissionRequest, setPermissionRequest] = useState<PermissionRequestPayload | null>(null);
  const [userInputRequest, setUserInputRequest] = useState<UserInputRequestPayload | null>(null);
  const [actions, setActions] = useState<ActionButtonPayload[]>([]);
  const audioRecordingRef = useRef<Audio.Recording | null>(null);

  // Non-blocking toast notification state
  const [toastText, setToastText] = useState<string>('');
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const chat = useChat(ws);

  // ── Voice recording handlers (ChatGPT-style: tap to toggle, no auto-send) ──
  const handleMicToggle = useCallback(async () => {
    if (voiceState === 'recording') {
      // ── Stop recording & transcribe ──
      const recording = audioRecordingRef.current;
      if (!recording) { setVoiceState('idle'); return; }

      try {
        await recording.stopAndUnloadAsync();
      } catch { /* already stopped */ }

      const uri = recording.getURI();
      audioRecordingRef.current = null;
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });

      if (!uri) {
        setVoiceState('idle');
        Alert.alert('Error', 'Audio file not found.');
        return;
      }

      setVoiceState('transcribing');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      try {
        const text = await transcribeAudio(uri);
        // Place transcribed text in the input field — do NOT auto-send.
        setInput((prev) => (prev ? prev + ' ' + text : text));
        setVoiceState('idle');
      } catch (e: any) {
        setVoiceState('idle');
        Alert.alert('Transcription Error', e.message || 'Audio transcription failed.');
      }
    } else if (voiceState === 'idle') {
      // ── Start recording ──
      try {
        const permission = await Audio.requestPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Permission Required', 'Please allow microphone access to record.');
          return;
        }

        if (audioRecordingRef.current) {
          try { await audioRecordingRef.current.stopAndUnloadAsync(); } catch { }
          audioRecordingRef.current = null;
        }

        await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
        const { recording } = await Audio.Recording.createAsync(
          Audio.RecordingOptionsPresets.HIGH_QUALITY
        );
        audioRecordingRef.current = recording;
        setVoiceState('recording');
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch (e) {
        console.error('Failed to start recording:', e);
        Alert.alert('Error', 'Could not start recording.');
      }
    }
  }, [voiceState]);

  useEffect(() => {
    return () => {
      if (audioRecordingRef.current) {
        audioRecordingRef.current.stopAndUnloadAsync().catch(() => null);
      }
    };
  }, []);

  // Attach callbacks to the root ws passed by props
  useEffect(() => {
    ws.callbacksRef.current = {
      onChunk: chat.onChunk,
      onDone: chat.onDone,
      onError: chat.onError,
      onPermissionRequest: (data: PermissionRequestPayload) => setPermissionRequest(data),
      onUserInputRequest: (data: UserInputRequestPayload) => setUserInputRequest(data),
      onActionRequired: (data: ActionButtonPayload[]) => setActions(data),
      onNotification: (data: any) => {
        const text = data.body || data.title || data.message || '';
        if (!text) return;
        setToastText(text);
        Animated.timing(toastOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        toastTimerRef.current = setTimeout(() => {
          Animated.timing(toastOpacity, { toValue: 0, duration: 400, useNativeDriver: true }).start();
        }, 2000);
      },
    };
  }, [ws, chat]);

  // Sync model and mode from extension into local state
  useEffect(() => {
    if (ws.model) setCurrentModel(ws.model);
  }, [ws.model]);

  useEffect(() => {
    if (ws.mode && ['ask', 'agent', 'plan'].includes(ws.mode)) {
      setCurrentMode(ws.mode as Mode);
    }
  }, [ws.mode]);

  const handleModeChange = (mode: Mode) => {
    setCurrentMode(mode);
    ws.send({ type: 'switch_mode', mode });
  };

  const handleModelChange = (model: string) => {
    setCurrentModel(model);
    ws.send({ type: 'switch_model', model });
  };

  const handlePermissionDecision = (id: string, decision: 'allow' | 'allow_session' | 'allow_all' | 'deny') => {
    ws.send({ type: 'permission', id, decision });
    setPermissionRequest(null);
  };

  const handleUserInputAnswer = (answer: string) => {
    ws.send({ type: 'user_input', answer });
    setUserInputRequest(null);
  };

  const handleAction = (actionId: string) => {
    ws.send({ type: 'action', action: actionId });
    setActions([]);
  };

  const handleSend = () => {
    const hasContent = input.trim() || attachments.length > 0;
    if (!hasContent || chat.isGenerating) return;
    const modelToSend = overrideModel ? currentModel : undefined;
    setActions([]);

    // Send only the user's text (no raw URIs)
    const content = input.trim() || (attachments.length > 0 ? '(attachment)' : '');
    
    // Pass attachments as structured data for visual display in bubble
    chat.sendPrompt(content, currentMode, modelToSend, attachments.length > 0 ? attachments : undefined);

    setInput('');
    setAttachments([]);
    setOverrideModel(false);
    ws.clearModifiedFiles();
  };

  const handleCancel = () => {
    ws.send({ type: 'cancel_task' });
    chat.onCancel();
    setActions([]);
  };

  const removeAttachment = (id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  };

  const handleAttachmentPress = async (type: 'image' | 'file' | 'camera' | 'audio') => {
    setShowAttachmentMenu(false);
    try {
      if (type === 'audio') {
        // Trigger voice recording
        handleMicToggle();
        return;
      }

      if (type === 'image') {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Permission Required', 'Please allow gallery access.');
          return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsEditing: false,
          quality: 0.8,
        });
        if (result.canceled || result.assets.length === 0) return;
        const asset = result.assets[0];
        setAttachments(prev => [...prev, {
          id: Date.now().toString(),
          type: 'image',
          uri: asset.uri,
          name: asset.fileName || 'photo.jpg',
          mimeType: asset.mimeType || 'image/jpeg',
        }]);
        return;
      }

      if (type === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Permission Required', 'Please allow camera access.');
          return;
        }
        const result = await ImagePicker.launchCameraAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsEditing: false,
          quality: 0.8,
        });
        if (result.canceled || result.assets.length === 0) return;
        const asset = result.assets[0];
        setAttachments(prev => [...prev, {
          id: Date.now().toString(),
          type: 'image',
          uri: asset.uri,
          name: asset.fileName || 'camera.jpg',
          mimeType: asset.mimeType || 'image/jpeg',
        }]);
        return;
      }

      // File picker
      const result = await DocumentPicker.getDocumentAsync({
        type: ['*/*'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || result.assets.length === 0) return;
      const asset = result.assets[0];
      const isPdf = (asset.mimeType || '').includes('pdf') || asset.name.toLowerCase().endsWith('.pdf');
      setAttachments(prev => [...prev, {
        id: Date.now().toString(),
        type: 'file',
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType || (isPdf ? 'application/pdf' : 'application/octet-stream'),
      }]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      Alert.alert('Error', `Could not select file: ${message}`);
    }
  };

  const renderHeader = () => (
    <View style={styles.header}>
      <View style={styles.headerTopRow}>
        <View style={styles.logoRow}>
          <Logo width={20} height={20} />
          <Text style={styles.projectText}>PocketPilot</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity onPress={toggleTheme} style={{ marginRight: 16 }}>
            <Text style={{ fontSize: 20 }}>{theme === 'dark' ? '☀️' : '🌙'}</Text>
          </TouchableOpacity>
          <ModelSelector currentModel={currentModel} onModelChange={handleModelChange} availableModels={ws.availableModels} />
        </View>
      </View>
      <Text style={styles.subtitleText}>{currentModel} · {currentMode}</Text>
      
      <View style={{ marginTop: 12 }}>
        <ModeSelector 
          currentMode={currentMode} 
          onModeChange={handleModeChange} 
          disabled={chat.isGenerating} 
        />
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView 
      style={styles.container} 
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <PermissionModal request={permissionRequest} onDecision={handlePermissionDecision} />
      <UserInputModal request={userInputRequest} onAnswer={handleUserInputAnswer} />
      
      {renderHeader()}

      {/* Non-blocking toast notification bar */}
      {toastText ? (
        <Animated.View style={[styles.toastBar, { opacity: toastOpacity }]}>
          <Text style={styles.toastText} numberOfLines={1}>⚡ {toastText}</Text>
        </Animated.View>
      ) : null}
      
      <FlatList
        ref={flatListRef}
        data={chat.messages}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <MessageBubble
            message={item}
            onEditMessage={(msg: any) => {
              setInput(msg.content || '');
            }}
          />
        )}
        ListFooterComponent={
          !chat.isGenerating && ws.modifiedFiles.length > 0
            ? <FilesModifiedSummary files={ws.modifiedFiles} />
            : null
        }
        contentContainerStyle={styles.listContent}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        onLayout={() => flatListRef.current?.scrollToEnd({ animated: true })}
      />

      <StreamingIndicator 
        visible={chat.isGenerating} 
        activity={ws.activity}
      />

      <ActionButtons actions={actions} onAction={handleAction} />

      {/* Inline voice recording indicator (no overlay — keeps input accessible) */}

      <View style={styles.footerContainer}>
        {showAttachmentMenu && (
          <View style={styles.attachmentsMenu}>
            <TouchableOpacity style={styles.attachmentItem} onPress={() => handleAttachmentPress('camera')}>
              <Text style={styles.attachmentIcon}>📷</Text>
              <Text style={styles.attachmentLabel}>Camera</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.attachmentItem} onPress={() => handleAttachmentPress('image')}>
              <Text style={styles.attachmentIcon}>🖼️</Text>
              <Text style={styles.attachmentLabel}>Gallery</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.attachmentItem, styles.attachmentItemLast]} onPress={() => handleAttachmentPress('file')}>
              <Text style={styles.attachmentIcon}>📎</Text>
              <Text style={styles.attachmentLabel}>File</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.inputWrapper}>
          {/* Attachment thumbnails */}
          {attachments.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.thumbnailRow}>
              {attachments.map((att) => (
                <View key={att.id} style={styles.thumbnailContainer}>
                  {att.type === 'image' ? (
                    <Image source={{ uri: att.uri }} style={styles.thumbnailImage} />
                  ) : (
                    <View style={styles.fileThumbnail}>
                      <Text style={styles.fileIcon}>
                        {att.mimeType.includes('pdf') ? '📕' : '📄'}
                      </Text>
                      <Text style={styles.fileName} numberOfLines={1}>{att.name}</Text>
                      {att.mimeType.includes('pdf') && (
                        <Text style={styles.fileType}>PDF</Text>
                      )}
                    </View>
                  )}
                  <TouchableOpacity
                    style={styles.removeAttachmentBtn}
                    onPress={() => removeAttachment(att.id)}
                  >
                    <Text style={styles.removeAttachmentText}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          )}

          {/* Input row */}
          <View style={styles.inputRow}>
            <TouchableOpacity
              style={styles.plusButton}
              onPress={() => setShowAttachmentMenu((prev) => !prev)}
              activeOpacity={0.8}
            >
              <Text style={styles.plusButtonText}>{showAttachmentMenu ? '×' : '+'}</Text>
            </TouchableOpacity>
            <TextInput
              style={styles.input}
              value={input}
              onChangeText={setInput}
              placeholder={
                voiceState === 'recording' ? 'Listening…' :
                voiceState === 'transcribing' ? 'Transcribing…' :
                'Ask a question'
              }
              placeholderTextColor={voiceState === 'recording' ? '#FF3B30' : '#888'}
              multiline
              editable={voiceState === 'idle'}
            />
            {/* Mic button — always visible, toggles recording */}
            {!chat.isGenerating && (
              <TouchableOpacity
                style={[styles.micButton, voiceState === 'recording' && styles.micButtonRecording]}
                onPress={handleMicToggle}
                disabled={voiceState === 'transcribing'}
                activeOpacity={0.7}
              >
                <Text style={styles.micIcon}>{voiceState === 'recording' ? '⏹' : '🎙'}</Text>
              </TouchableOpacity>
            )}
            {/* Send / Cancel / Settings button */}
            {chat.isGenerating ? (
              <TouchableOpacity style={styles.cancelButtonIcon} onPress={handleCancel}>
                <Text style={styles.buttonText}>⏹</Text>
              </TouchableOpacity>
            ) : (input.trim() || attachments.length > 0) ? (
              <TouchableOpacity style={styles.sendButtonIcon} onPress={handleSend}>
                <Text style={styles.buttonText}>➤</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.page2Button}
                onPress={() => navigation.navigate('Settings', { onClear: () => chat.clearHistory() })}
              >
                <Text style={styles.page2Icon}>⚡</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 60 : 30,
    paddingBottom: 16,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  projectText: {
    color: colors.text,
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  subtitleText: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 4,
  },
  toastBar: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  toastText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '500',
  },
  listContent: {
    padding: 16,
    flexGrow: 1,
  },
  footerContainer: {
    backgroundColor: colors.background,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    position: 'relative',
    zIndex: 10,
  },
  attachmentsMenu: {
    position: 'absolute',
    left: 14,
    bottom: 78,
    width: 160,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'visible',
    zIndex: 999,
    elevation: 10,
  },
  attachmentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  attachmentItemLast: {
    borderBottomWidth: 0,
  },
  attachmentLabel: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  attachmentIcon: {
    fontSize: 18,
  },
  // ── Input wrapper (contains thumbnails + input row) ──
  inputWrapper: {
    backgroundColor: colors.inputBackground,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  thumbnailRow: {
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 4,
  },
  thumbnailContainer: {
    marginRight: 8,
    position: 'relative',
  },
  thumbnailImage: {
    width: 60,
    height: 60,
    borderRadius: 10,
    backgroundColor: colors.border,
  },
  fileThumbnail: {
    width: 120,
    height: 60,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  fileIcon: {
    fontSize: 22,
  },
  fileName: {
    color: colors.text,
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
    maxWidth: 100,
  },
  fileType: {
    color: '#FF3B30',
    fontSize: 9,
    fontWeight: 'bold',
    marginTop: 1,
  },
  removeAttachmentBtn: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.text,
    justifyContent: 'center',
    alignItems: 'center',
  },
  removeAttachmentText: {
    color: colors.background,
    fontSize: 11,
    fontWeight: 'bold',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 8,
    paddingLeft: 6,
  },
  plusButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginLeft: 2,
    marginRight: 8,
  },
  plusButtonText: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '600',
    marginTop: -1,
  },
  input: {
    flex: 1,
    color: colors.text,
    paddingHorizontal: 10,
    paddingTop: 12,
    paddingBottom: 12,
    maxHeight: 120,
    minHeight: 45,
    fontSize: 15,
  },
  sendButtonIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  sendButtonDisabled: {
    backgroundColor: colors.accent + '55',
  },
  cancelButtonIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F44336',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  buttonText: {
    color: '#FFF',
    fontWeight: '600',
    fontSize: 16,
  },
  // ── Voice / Mic styles ──
  micButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  micButtonRecording: {
    backgroundColor: '#FF3B30',
    borderColor: '#FF3B30',
  },
  micIcon: {
    fontSize: 18,
  },
  page2Button: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  page2Icon: {
    fontSize: 18,
    color: colors.accent,
  },
});