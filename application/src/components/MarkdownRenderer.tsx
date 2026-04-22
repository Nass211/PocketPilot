import React from 'react';
import { Text, View, StyleSheet } from 'react-native';

export default function MarkdownRenderer({ content, color = '#000000' }: { content: string, color?: string }) {
  return (
    <View style={styles.container}>
      <Text style={[styles.text, { color }]}>{content}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 4, flex: 1 },
  text: { fontSize: 16, lineHeight: 24 },
});
