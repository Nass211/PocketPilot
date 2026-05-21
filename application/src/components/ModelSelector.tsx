import React, { useMemo, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, FlatList, Pressable } from 'react-native';
import { useTheme, ThemeColors } from '../context/ThemeContext';
import { AvailableModel } from '../hooks/useWebSocket';

interface ModelSelectorProps {
  currentModel: string;
  onModelChange: (model: string) => void;
  availableModels?: AvailableModel[];
}

// No fallback models — we rely on the extension sending available models via the SDK.
// If no models have been received yet, only 'auto' is shown.

const isBlockedModel = (model: string) => model.toLowerCase().includes('sonnet');

export default function ModelSelector({ currentModel, onModelChange, availableModels }: ModelSelectorProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [modalVisible, setModalVisible] = useState(false);

  // Use dynamic models from extension if available, otherwise show only 'auto'
  const models = useMemo(() => {
    if (availableModels && availableModels.length > 0) {
      const ids = availableModels.map(m => m.id).filter(id => !isBlockedModel(id));
      return ['auto', ...ids];
    }
    return ['auto'];
  }, [availableModels]);

  // Build a display name map for nicer labels
  const displayNames = useMemo(() => {
    const map: Record<string, string> = { auto: 'Auto' };
    if (availableModels) {
      for (const m of availableModels) {
        if (isBlockedModel(m.id)) continue;
        map[m.id] = m.displayName || m.id;
      }
    }
    return map;
  }, [availableModels]);

  const selectModel = (model: string) => {
    onModelChange(model);
    setModalVisible(false);
  };

  return (
    <>
      <TouchableOpacity style={styles.button} onPress={() => setModalVisible(true)}>
        <Text style={styles.buttonText}>{displayNames[currentModel] || currentModel || 'Select Model'}</Text>
      </TouchableOpacity>

      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          {/* Backdrop: tapping here dismisses the modal */}
          <Pressable style={styles.backdrop} onPress={() => setModalVisible(false)} />

          {/* Bottom sheet: touch events here are NOT intercepted — FlatList scrolls freely */}
          <View style={styles.bottomSheet}>
            <View style={styles.dragHandleContainer}>
              <View style={styles.dragHandle} />
            </View>
            <Text style={styles.sheetTitle}>Choose a model</Text>
            <FlatList
              data={models}
              keyExtractor={(item) => item}
              bounces={true}
              showsVerticalScrollIndicator={true}
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => (
                <TouchableOpacity 
                  style={[styles.item, currentModel === item && styles.itemActive]} 
                  onPress={() => selectModel(item)}
                >
                  <Text style={[styles.itemText, currentModel === item && styles.itemTextActive]}>
                    {displayNames[item] || item}
                  </Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>
    </>
  );
};

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  button: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.inputBackground,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    alignSelf: 'center',
    marginBottom: 8,
  },
  buttonText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '500',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  backdrop: {
    flex: 1,
  },
  bottomSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingBottom: 32, // safe area for bottom nav
    maxHeight: '65%',
  },
  dragHandleContainer: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.textSecondary || '#666',
    opacity: 0.5,
  },
  sheetTitle: {
    color: colors.textSecondary,
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 12,
    textAlign: 'center',
  },
  listContent: {
    paddingBottom: 16,
  },
  item: {
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  itemActive: {
    backgroundColor: colors.accent + '22',
    borderRadius: 8,
  },
  itemText: {
    color: colors.text,
    fontSize: 16,
    textAlign: 'center',
  },
  itemTextActive: {
    color: colors.accent,
    fontWeight: 'bold',
  },
});

