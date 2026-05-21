import React, { useMemo, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Animated,
} from 'react-native';
import { useTheme, ThemeColors } from '../context/ThemeContext';

export interface DiffPayload {
  id: string;
  file: string;
  before: string;
  after: string;
}

interface DiffViewerProps {
  diff: DiffPayload;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
}

interface DiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
  lineNum?: number;
}

/**
 * Compute a simple unified-style diff between two strings.
 * Shows removed lines (from `before`), added lines (from `after`),
 * and unchanged context lines.
 */
function computeDiff(before: string, after: string): DiffLine[] {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const result: DiffLine[] = [];

  // Simple LCS-based diff
  const m = beforeLines.length;
  const n = afterLines.length;

  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (beforeLines[i - 1] === afterLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to build diff
  const diffItems: DiffLine[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && beforeLines[i - 1] === afterLines[j - 1]) {
      diffItems.unshift({ type: 'context', content: beforeLines[i - 1], lineNum: j });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      diffItems.unshift({ type: 'add', content: afterLines[j - 1], lineNum: j });
      j--;
    } else {
      diffItems.unshift({ type: 'remove', content: beforeLines[i - 1], lineNum: i });
      i--;
    }
  }

  return diffItems;
}

export default function DiffViewer({ diff, onAccept, onReject }: DiffViewerProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const slideAnim = useRef(new Animated.Value(60)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const [expanded, setExpanded] = useState(true);

  const diffLines = useMemo(() => computeDiff(diff.before, diff.after), [diff.before, diff.after]);

  const stats = useMemo(() => {
    let additions = 0, deletions = 0;
    for (const line of diffLines) {
      if (line.type === 'add') additions++;
      if (line.type === 'remove') deletions++;
    }
    return { additions, deletions };
  }, [diffLines]);

  useEffect(() => {
    Animated.parallel([
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 50,
        friction: 8,
      }),
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start();
  }, [slideAnim, opacityAnim]);

  // Extract just the filename from a full path
  const fileName = diff.file.split('/').pop() || diff.file;
  const filePath = diff.file;

  return (
    <Animated.View
      style={[
        styles.container,
        { transform: [{ translateY: slideAnim }], opacity: opacityAnim },
      ]}
    >
      {/* Header */}
      <TouchableOpacity
        style={styles.header}
        onPress={() => setExpanded(!expanded)}
        activeOpacity={0.7}
      >
        <View style={styles.headerLeft}>
          <Text style={styles.fileIcon}>📄</Text>
          <View style={styles.headerTextContainer}>
            <Text style={styles.fileName} numberOfLines={1}>{fileName}</Text>
            <Text style={styles.filePath} numberOfLines={1}>{filePath}</Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          <Text style={styles.statsAdd}>+{stats.additions}</Text>
          <Text style={styles.statsRemove}>-{stats.deletions}</Text>
          <Text style={styles.chevron}>{expanded ? '▾' : '▸'}</Text>
        </View>
      </TouchableOpacity>

      {/* Diff content */}
      {expanded && (
        <ScrollView
          style={styles.diffScroll}
          horizontal={false}
          showsVerticalScrollIndicator={true}
          nestedScrollEnabled={true}
        >
          <ScrollView
            horizontal={true}
            showsHorizontalScrollIndicator={false}
            nestedScrollEnabled={true}
          >
            <View style={styles.diffContent}>
              {diffLines.map((line, index) => (
                <View
                  key={index}
                  style={[
                    styles.diffLine,
                    line.type === 'add' && styles.diffLineAdd,
                    line.type === 'remove' && styles.diffLineRemove,
                  ]}
                >
                  <Text
                    style={[
                      styles.diffLinePrefix,
                      line.type === 'add' && styles.diffLinePrefixAdd,
                      line.type === 'remove' && styles.diffLinePrefixRemove,
                    ]}
                  >
                    {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
                  </Text>
                  <Text
                    style={[
                      styles.diffLineText,
                      line.type === 'add' && styles.diffLineTextAdd,
                      line.type === 'remove' && styles.diffLineTextRemove,
                      line.type === 'context' && styles.diffLineTextContext,
                    ]}
                    numberOfLines={1}
                  >
                    {line.content || ' '}
                  </Text>
                </View>
              ))}
            </View>
          </ScrollView>
        </ScrollView>
      )}

      {/* Action buttons */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.actionButton, styles.rejectButton]}
          onPress={() => onReject(diff.id)}
          activeOpacity={0.7}
        >
          <Text style={styles.rejectButtonText}>✕ Reject</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, styles.acceptButton]}
          onPress={() => onAccept(diff.id)}
          activeOpacity={0.7}
        >
          <Text style={styles.acceptButtonText}>✓ Accept</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    marginHorizontal: 12,
    marginVertical: 6,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
  },
  fileIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  headerTextContainer: {
    flex: 1,
  },
  fileName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  filePath: {
    color: colors.textSecondary,
    fontSize: 11,
    marginTop: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statsAdd: {
    color: '#34C759',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  statsRemove: {
    color: '#FF3B30',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  chevron: {
    color: colors.textSecondary,
    fontSize: 14,
    marginLeft: 4,
  },
  diffScroll: {
    maxHeight: 280,
  },
  diffContent: {
    paddingVertical: 4,
    minWidth: '100%',
  },
  diffLine: {
    flexDirection: 'row',
    paddingHorizontal: 10,
    paddingVertical: 1,
    minHeight: 22,
    alignItems: 'center',
  },
  diffLineAdd: {
    backgroundColor: 'rgba(52, 199, 89, 0.12)',
  },
  diffLineRemove: {
    backgroundColor: 'rgba(255, 59, 48, 0.12)',
  },
  diffLinePrefix: {
    width: 18,
    fontFamily: 'monospace',
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    textAlign: 'center',
  },
  diffLinePrefixAdd: {
    color: '#34C759',
  },
  diffLinePrefixRemove: {
    color: '#FF3B30',
  },
  diffLineText: {
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 20,
  },
  diffLineTextAdd: {
    color: '#34C759',
  },
  diffLineTextRemove: {
    color: '#FF3B30',
  },
  diffLineTextContext: {
    color: colors.textSecondary,
  },
  actions: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rejectButton: {
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  rejectButtonText: {
    color: '#FF3B30',
    fontSize: 14,
    fontWeight: '600',
  },
  acceptButton: {
    backgroundColor: 'rgba(52, 199, 89, 0.08)',
  },
  acceptButtonText: {
    color: '#34C759',
    fontSize: 14,
    fontWeight: '600',
  },
});
