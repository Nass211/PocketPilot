import React, { useMemo, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Animated, Modal,
  SafeAreaView,
} from 'react-native';
import { useTheme, ThemeColors } from '../context/ThemeContext';

export interface ModifiedFileInfo {
  file: string;
  additions: number;
  deletions: number;
  diff: string;
}

interface DiffLine {
  type: 'add' | 'remove' | 'context' | 'header';
  content: string;
}

/** Parse a unified diff string into displayable lines */
function parseUnifiedDiff(diff: string): DiffLine[] {
  const lines = diff.split('\n');
  const result: DiffLine[] = [];

  for (const line of lines) {
    if (line.startsWith('@@')) {
      result.push({ type: 'header', content: line });
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      result.push({ type: 'add', content: line.slice(1) });
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      result.push({ type: 'remove', content: line.slice(1) });
    } else if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) {
      // Skip diff metadata headers
    } else {
      result.push({ type: 'context', content: line.startsWith(' ') ? line.slice(1) : line });
    }
  }

  return result;
}

/** Get file extension label with color */
function getFileTag(file: string): { label: string; color: string } {
  const ext = file.split('.').pop()?.toLowerCase() || '';
  const tags: Record<string, { label: string; color: string }> = {
    'ts': { label: 'TS', color: '#3178C6' },
    'tsx': { label: 'TSX', color: '#3178C6' },
    'js': { label: 'JS', color: '#F7DF1E' },
    'jsx': { label: 'JSX', color: '#61DAFB' },
    'json': { label: 'JSON', color: '#5B5B5B' },
    'md': { label: 'MD', color: '#083FA1' },
    'css': { label: 'CSS', color: '#1572B6' },
    'html': { label: 'HTML', color: '#E34C26' },
    'py': { label: 'PY', color: '#3776AB' },
    'rs': { label: 'RS', color: '#CE422B' },
    'go': { label: 'GO', color: '#00ADD8' },
    'svg': { label: 'SVG', color: '#FFB13B' },
    'sh': { label: 'SH', color: '#4EAA25' },
  };
  return tags[ext] || { label: ext.toUpperCase() || '?', color: '#636366' };
}

/** Files Modified Summary — inline chat component showing chips per modified file */
export function FilesModifiedSummary({ files }: { files: ModifiedFileInfo[] }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createChipStyles(colors), [colors]);
  const [selectedFile, setSelectedFile] = useState<ModifiedFileInfo | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  if (files.length === 0) return null;

  return (
    <>
      <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
        <View style={styles.header}>
          <Text style={styles.title}>Files Modified</Text>
          <View style={styles.countBadge}>
            <Text style={styles.countText}>{files.length}</Text>
          </View>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
          {files.map((f, i) => {
            const fileName = f.file.split('/').pop() || f.file;
            const tag = getFileTag(f.file);
            return (
              <TouchableOpacity
                key={i}
                style={styles.chip}
                onPress={() => setSelectedFile(f)}
                activeOpacity={0.7}
              >
                <View style={[styles.fileTag, { backgroundColor: tag.color }]}>
                  <Text style={styles.fileTagText}>{tag.label}</Text>
                </View>
                <Text style={styles.chipName} numberOfLines={1}>{fileName}</Text>
                <Text style={styles.chipAdd}>+{f.additions}</Text>
                <Text style={styles.chipDel}>-{f.deletions}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </Animated.View>

      {/* Diff Viewer Modal */}
      <Modal
        visible={!!selectedFile}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setSelectedFile(null)}
      >
        {selectedFile && (
          <DiffViewerModal
            file={selectedFile}
            onClose={() => setSelectedFile(null)}
          />
        )}
      </Modal>
    </>
  );
}

/** Full-screen diff viewer modal */
function DiffViewerModal({ file, onClose }: { file: ModifiedFileInfo; onClose: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createDiffStyles(colors), [colors]);
  const diffLines = useMemo(() => parseUnifiedDiff(file.diff), [file.diff]);
  const fileName = file.file.split('/').pop() || file.file;
  const tag = getFileTag(file.file);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.closeButton} activeOpacity={0.7}>
          <Text style={styles.closeText}>←</Text>
        </TouchableOpacity>
        <View style={[styles.headerTag, { backgroundColor: tag.color }]}>
          <Text style={styles.headerTagText}>{tag.label}</Text>
        </View>
        <View style={styles.headerInfo}>
          <Text style={styles.headerFileName} numberOfLines={1}>{fileName}</Text>
          <Text style={styles.headerFilePath} numberOfLines={1}>{file.file}</Text>
        </View>
        <View style={styles.headerStats}>
          <Text style={styles.statsAdd}>+{file.additions}</Text>
          <Text style={styles.statsDel}>-{file.deletions}</Text>
        </View>
      </View>

      {/* Diff content */}
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={true}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} nestedScrollEnabled>
          <View style={styles.diffContent}>
            {diffLines.map((line, index) => (
              <View
                key={index}
                style={[
                  styles.diffLine,
                  line.type === 'add' && styles.diffLineAdd,
                  line.type === 'remove' && styles.diffLineRemove,
                  line.type === 'header' && styles.diffLineHeader,
                ]}
              >
                <Text style={styles.lineNumber}>
                  {line.type === 'header' ? '' : String(index + 1).padStart(3)}
                </Text>
                <Text
                  style={[
                    styles.diffLinePrefix,
                    line.type === 'add' && styles.prefixAdd,
                    line.type === 'remove' && styles.prefixRemove,
                    line.type === 'header' && styles.prefixHeader,
                  ]}
                >
                  {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : line.type === 'header' ? '@@' : ' '}
                </Text>
                <Text
                  style={[
                    styles.diffLineText,
                    line.type === 'add' && styles.textAdd,
                    line.type === 'remove' && styles.textRemove,
                    line.type === 'header' && styles.textHeader,
                    line.type === 'context' && styles.textContext,
                  ]}
                >
                  {line.content || ' '}
                </Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Chip styles ──────────────────────────────────────────────────────

const createChipStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginTop: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  title: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  countBadge: {
    backgroundColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 1,
    minWidth: 20,
    alignItems: 'center',
  },
  countText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
  },
  chipScroll: {
    flexDirection: 'row',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginRight: 8,
    gap: 5,
  },
  fileTag: {
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  fileTagText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  chipName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
    maxWidth: 140,
  },
  chipAdd: {
    color: '#34C759',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  chipDel: {
    color: '#FF3B30',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
});

// ── Diff viewer styles ──────────────────────────────────────────────

const createDiffStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d1117',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
    backgroundColor: '#161b22',
    borderBottomWidth: 1,
    borderBottomColor: '#30363d',
    gap: 10,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#30363d',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    color: '#c9d1d9',
    fontSize: 18,
    fontWeight: '700',
  },
  headerTag: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  headerTagText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  headerInfo: {
    flex: 1,
  },
  headerFileName: {
    color: '#c9d1d9',
    fontSize: 16,
    fontWeight: '700',
  },
  headerFilePath: {
    color: '#8b949e',
    fontSize: 11,
    marginTop: 2,
  },
  headerStats: {
    flexDirection: 'row',
    gap: 6,
  },
  statsAdd: {
    color: '#3fb950',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  statsDel: {
    color: '#f85149',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  scrollView: {
    flex: 1,
  },
  diffContent: {
    paddingVertical: 4,
    minWidth: '100%',
  },
  diffLine: {
    flexDirection: 'row',
    paddingRight: 10,
    minHeight: 22,
    alignItems: 'center',
  },
  diffLineAdd: {
    backgroundColor: 'rgba(63, 185, 80, 0.15)',
  },
  diffLineRemove: {
    backgroundColor: 'rgba(248, 81, 73, 0.15)',
  },
  diffLineHeader: {
    backgroundColor: 'rgba(56, 139, 253, 0.1)',
    paddingVertical: 4,
    marginTop: 6,
  },
  lineNumber: {
    width: 36,
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#484f58',
    textAlign: 'right',
    paddingRight: 8,
  },
  diffLinePrefix: {
    width: 18,
    fontFamily: 'monospace',
    fontSize: 12,
    fontWeight: '700',
    color: '#484f58',
    textAlign: 'center',
  },
  prefixAdd: { color: '#3fb950' },
  prefixRemove: { color: '#f85149' },
  prefixHeader: { color: '#388bfd' },
  diffLineText: {
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 20,
  },
  textAdd: { color: '#aff5b4' },
  textRemove: { color: '#ffd7d5' },
  textHeader: { color: '#388bfd', fontStyle: 'italic' },
  textContext: { color: '#8b949e' },
});
