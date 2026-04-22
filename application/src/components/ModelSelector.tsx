import React, { useMemo, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, FlatList, TouchableWithoutFeedback } from 'react-native';
import { useTheme, ThemeColors } from '../context/ThemeContext';

interface ModelSelectorProps {
  currentModel: string;
  onModelChange: (model: string) => void;
}

export default function ModelSelector({ currentModel, onModelChange }: ModelSelectorProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [modalVisible, setModalVisible] = useState(false);
  const models = ['auto', 'GPT-4o', 'GPT-4.1', 'GPT-4.1-mini', 'claude-sonnet-4', 'o3', 'o4-mini'];

  const selectModel = (model: string) => {
    onModelChange(model);
    setModalVisible(false);
  };

  return (
    <>
      <TouchableOpacity style={styles.button} onPress={() => setModalVisible(true)}>
        <Text style={styles.buttonText}>{currentModel || 'Select Model'}</Text>
      </TouchableOpacity>

      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}
      >
        <TouchableWithoutFeedback onPress={() => setModalVisible(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.bottomSheet}>
              <Text style={styles.sheetTitle}>Choose a model</Text>
              <FlatList
                data={models}
                keyExtractor={(item) => item}
                renderItem={({ item }) => (
                  <TouchableOpacity 
                    style={[styles.item, currentModel === item && styles.itemActive]} 
                    onPress={() => selectModel(item)}
                  >
                    <Text style={[styles.itemText, currentModel === item && styles.itemTextActive]}>
                      {item === 'auto' ? 'Auto' : item}
                    </Text>
                  </TouchableOpacity>
                )}
              />
            </View>
          </View>
        </TouchableWithoutFeedback>
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
  bottomSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    maxHeight: '60%',
  },
  sheetTitle: {
    color: colors.textSecondary,
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 12,
    textAlign: 'center',
  },
  item: {
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  itemActive: {
    backgroundColor: colors.accent + '22',
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
