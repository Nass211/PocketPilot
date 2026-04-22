import React from 'react';
import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { 
  View, Text, TextInput, TouchableOpacity, FlatList, 
  StyleSheet, KeyboardAvoidingView, Platform, Alert 
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
import { Mode } from '../types/messages';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Audio } from 'expo-av';
import Logo from '../components/Logo';

export default function ChatScreen({ navigation, route }: any) {
  const ws = useAppContext();
  const { colors, theme, toggleTheme } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [input, setInput] = useState('');
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [currentMode, setCurrentMode] = useState<Mode>('ask');
  const [currentModel, setCurrentModel] = useState<string>('Claude Sonnet 4.6');
  const [overrideModel, setOverrideModel] = useState<boolean>(false);
  const flatListRef = useRef<FlatList>(null);

  // States for modals
  const [permissionRequest, setPermissionRequest] = useState<PermissionRequestPayload | null>(null);
  const [userInputRequest, setUserInputRequest] = useState<UserInputRequestPayload | null>(null);
  const [actions, setActions] = useState<ActionButtonPayload[]>([]);
  const audioRecordingRef = useRef<Audio.Recording | null>(null);

  const chat = useChat(ws);

  // Attach callbacks to the root ws passed by props
  useEffect(() => {
    ws.callbacksRef.current = {
      onChunk: chat.onChunk,
      onDone: chat.onDone,
      onError: chat.onError,
      onPermissionRequest: (data: PermissionRequestPayload) => setPermissionRequest(data),
      onUserInputRequest: (data: UserInputRequestPayload) => setUserInputRequest(data),
      onActionRequired: (data: ActionButtonPayload[]) => setActions(data),
      onNotification: (data: any) => Alert.alert('Notification', data.message || JSON.stringify(data)),
    };
  }, [ws, chat]);

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
    setActions([]); // Hide buttons after clicking
  };

  const handleSend = () => {
    if (!input.trim() || chat.isGenerating) return;
    const modelToSend = overrideModel ? currentModel : undefined;
    setActions([]); // Clear task mode actions on message
    chat.sendPrompt(input.trim(), currentMode, modelToSend);
    setInput('');
    setOverrideModel(false);
  };

  const handleCancel = () => {
    ws.send({ type: 'cancel_task' });
    chat.onCancel();
    setActions([]);
  };

  const appendAttachmentToInput = (label: string, name: string, uri: string, mimeType?: string) => {
    const mime = mimeType || 'unknown';
    const line = `[${label}] ${name} (${mime})\n${uri}`;
    setInput((prev) => (prev.trim() ? `${prev}\n${line}` : line));
  };

  const startAudioRecording = async () => {
    const permission = await Audio.requestPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission required', 'Allow microphone to record audio.');
      return;
    }

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
    });

    const recording = new Audio.Recording();
    await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
    await recording.startAsync();
    audioRecordingRef.current = recording;
    setIsRecordingAudio(true);
  };

  const stopAudioRecording = async (action: 'discard' | 'send' | 'append' = 'append') => {
    const recording = audioRecordingRef.current;
    if (!recording) return;

    try {
      await recording.stopAndUnloadAsync();
    } catch (e) {}

    const uri = recording.getURI();
    audioRecordingRef.current = null;
    setIsRecordingAudio(false);

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
    });

    if (action === 'discard') {
      return;
    }

    if (!uri) {
      Alert.alert('Error', 'Audio recorded, but file not found.');
      return;
    }

    const fileName = `audio-${Date.now()}.m4a`;

    if (action === 'send') {
      const mime = 'audio/m4a';
      const line = `[Audio] ${fileName} (${mime})\n${uri}`;
      
      const payload = input.trim() ? `${input.trim()}\n${line}` : line;
      const modelToSend = overrideModel ? currentModel : undefined;
      setActions([]);
      chat.sendPrompt(payload, currentMode, modelToSend);
      setInput('');
      setOverrideModel(false);
    } else {
      appendAttachmentToInput('Audio', fileName, uri, 'audio/m4a');
    }
  };

  useEffect(() => {
    return () => {
      if (audioRecordingRef.current) {
        audioRecordingRef.current.stopAndUnloadAsync().catch(() => null);
      }
    };
  }, []);

  const handleAttachmentPress = async (type: 'audio' | 'image' | 'file' | 'camera') => {
    setShowAttachmentMenu(false);
    try {
      if (type === 'image') {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Permission required', 'Allow gallery access to select an image.');
          return;
        }

        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsEditing: false,
          quality: 0.9,
        });

        if (result.canceled || result.assets.length === 0) return;

        const asset = result.assets[0];
        appendAttachmentToInput(
          'Image',
          asset.fileName || 'image.jpg',
          asset.uri,
          asset.mimeType || 'image/*'
        );
        return;
      }

      if (type === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Permission required', 'Allow camera access to take a picture.');
          return;
        }

        const result = await ImagePicker.launchCameraAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsEditing: false,
          quality: 0.9,
        });

        if (result.canceled || result.assets.length === 0) return;

        const asset = result.assets[0];
        appendAttachmentToInput(
          'Camera',
          asset.fileName || 'camera-image.jpg',
          asset.uri,
          asset.mimeType || 'image/*'
        );
        return;
      }

      if (type === 'audio') {
        if (isRecordingAudio) {
          await stopAudioRecording('append');
          return;
        }

        await startAudioRecording();
        return;
      }

      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (result.canceled || result.assets.length === 0) return;

      const asset = result.assets[0];
      appendAttachmentToInput('File', asset.name, asset.uri, asset.mimeType || 'application/octet-stream');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      Alert.alert('Error', `Unable to select attachment: ${message}`);
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
          <ModelSelector currentModel={currentModel} onModelChange={handleModelChange} />
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
      
      <FlatList
        ref={flatListRef}
        data={chat.messages}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <MessageBubble message={item} />}
        contentContainerStyle={styles.listContent}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        onLayout={() => flatListRef.current?.scrollToEnd({ animated: true })}
      />

      <StreamingIndicator 
        visible={chat.isGenerating && 
          chat.messages.length > 0 && 
          !chat.messages[chat.messages.length - 1].content} 
      />

      <ActionButtons actions={actions} onAction={handleAction} />

      <View style={styles.footerContainer}>
        {showAttachmentMenu && (
          <View style={styles.attachmentsMenu}>
            <TouchableOpacity style={styles.attachmentItem} onPress={() => handleAttachmentPress('audio')}>
              <Text style={styles.attachmentLabel}>{isRecordingAudio ? 'Stop Audio' : 'Audio'}</Text>
              <Text style={styles.attachmentIcon}>{isRecordingAudio ? '⏹️' : '🎤'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.attachmentItem} onPress={() => handleAttachmentPress('image')}>
              <Text style={styles.attachmentLabel}>Image</Text>
              <Text style={styles.attachmentIcon}>🖼️</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.attachmentItem} onPress={() => handleAttachmentPress('file')}>
              <Text style={styles.attachmentLabel}>File</Text>
              <Text style={styles.attachmentIcon}>📎</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.attachmentItem, styles.attachmentItemLast]}
              onPress={() => handleAttachmentPress('camera')}
            >
              <Text style={styles.attachmentLabel}>Camera</Text>
              <Text style={styles.attachmentIcon}>📷</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.inputContainer}>
          <View style={styles.inputGroup}>
            {isRecordingAudio ? (
              <View style={styles.recordingContainer}>
                <TouchableOpacity style={styles.stopRecordBtn} onPress={() => stopAudioRecording('discard')}>
                  <View style={styles.stopRecordSquare} />
                </TouchableOpacity>

                <View style={styles.recordingPill}>
                  <Text style={styles.waveformText} numberOfLines={1}>
                    I I I I I I I I I I I I I I I I I I I I I I I I I I I I I
                  </Text>
                </View>

                <TouchableOpacity style={styles.sendRecordBtn} onPress={() => stopAudioRecording('send')}>
                  <Text style={styles.sendRecordArrow}>↑</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
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
                  placeholder="Connect WebSocket..."
                  placeholderTextColor="#888"
                  multiline
                />
                {chat.isGenerating ? (
                  <TouchableOpacity style={styles.cancelButtonIcon} onPress={handleCancel}>
                    <Text style={styles.buttonText}>⏹</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity 
                    style={[styles.sendButtonIcon, !input.trim() && styles.sendButtonDisabled]} 
                    onPress={handleSend}
                    disabled={!input.trim()}
                  >
                    <Text style={styles.buttonText}>➤</Text>
                  </TouchableOpacity>
                )}
              </>
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
  },
  attachmentsMenu: {
    position: 'absolute',
    left: 14,
    bottom: 78,
    width: 150,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  attachmentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
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
    fontSize: 16,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  inputGroup: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.inputBackground,
    borderRadius: 12,
    alignItems: 'center',
    paddingRight: 8,
    paddingLeft: 6,
    borderWidth: 1,
    borderColor: colors.border,
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
  recordingContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 2,
    minHeight: 45,
  },
  stopRecordBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 4,
    marginRight: 8,
  },
  stopRecordSquare: {
    width: 12,
    height: 12,
    backgroundColor: colors.text,
    borderRadius: 3,
  },
  recordingPill: {
    flex: 1,
    height: 36,
    backgroundColor: colors.border,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  waveformText: {
    color: colors.textSecondary,
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 2,
  },
  sendRecordBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.text,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  sendRecordArrow: {
    color: colors.background,
    fontSize: 22,
    fontWeight: 'bold',
    marginTop: -2,
  },
});