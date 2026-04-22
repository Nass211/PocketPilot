import React, { useMemo, useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, Animated, TextInput, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useTheme, ThemeColors } from '../context/ThemeContext';

export interface UserInputRequestPayload {
  question: string;
  choices?: string[];
}

interface UserInputModalProps {
  request: UserInputRequestPayload | null;
  onAnswer: (answer: string) => void;
}

export default function UserInputModal({ request, onAnswer }: UserInputModalProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [answer, setAnswer] = useState('');
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);
  const scaleValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (request) {
      setAnswer('');
      setSelectedChoice(null);
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

  const handleSubmit = () => {
    const finalAnswer = request.choices && selectedChoice ? selectedChoice : answer.trim();
    if (finalAnswer) {
      onAnswer(finalAnswer);
    }
  };

  const isSubmitDisabled = request.choices ? !selectedChoice : !answer.trim();

  return (
    <Modal visible={!!request} transparent animationType="fade">
      <KeyboardAvoidingView 
        style={styles.overlay} 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Animated.View style={[styles.modalContainer, { transform: [{ scale: scaleValue }] }]}>
          <Text style={styles.questionText}>{request.question}</Text>

          {request.choices && request.choices.length > 0 ? (
            <ScrollView style={styles.choicesContainer} showsVerticalScrollIndicator={false}>
              {request.choices.map((choice, index) => (
                <TouchableOpacity
                  key={index}
                  style={[
                    styles.choiceButton,
                    selectedChoice === choice && styles.choiceButtonSelected
                  ]}
                  onPress={() => setSelectedChoice(choice)}
                >
                  <Text style={[
                    styles.choiceText,
                    selectedChoice === choice && styles.choiceTextSelected
                  ]}>
                    {choice}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          ) : (
            <TextInput
              style={styles.input}
              value={answer}
              onChangeText={setAnswer}
              placeholder="Your answer..."
              placeholderTextColor={colors.textSecondary}
              multiline
              autoFocus
            />
          )}

          <TouchableOpacity 
            style={[styles.submitButton, isSubmitDisabled && styles.submitButtonDisabled]}
            disabled={isSubmitDisabled}
            onPress={handleSubmit}
          >
            <Text style={styles.submitButtonText}>Submit</Text>
          </TouchableOpacity>
        </Animated.View>
      </KeyboardAvoidingView>
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
    maxHeight: '80%',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  questionText: {
    color: colors.text,
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  choicesContainer: {
    maxHeight: 250,
    marginBottom: 16,
  },
  choiceButton: {
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 12,
    backgroundColor: colors.inputBackground,
  },
  choiceButtonSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accent + '33',
  },
  choiceText: {
    color: colors.text,
    fontSize: 16,
  },
  choiceTextSelected: {
    color: colors.accent,
    fontWeight: 'bold',
  },
  input: {
    backgroundColor: colors.inputBackground,
    color: colors.text,
    borderRadius: 8,
    padding: 16,
    fontSize: 16,
    minHeight: 100,
    textAlignVertical: 'top',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  submitButton: {
    backgroundColor: colors.accent,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  submitButtonDisabled: {
    backgroundColor: colors.accent + '55',
  },
  submitButtonText: {
    color: colors.background, // Keep white text visibility using background
    fontSize: 16,
    fontWeight: '600',
  },
});