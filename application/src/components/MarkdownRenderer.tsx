import React, { useMemo } from 'react';
import { Platform, StyleSheet } from 'react-native';
import Markdown from 'react-native-markdown-display';

interface MarkdownRendererProps {
  content: string;
  color?: string;
}

export default function MarkdownRenderer({ content, color = '#ffffff' }: MarkdownRendererProps) {
  const markdownStyles = useMemo(() => createMarkdownStyles(color), [color]);

  return (
    <Markdown style={markdownStyles}>
      {content}
    </Markdown>
  );
}

const createMarkdownStyles = (textColor: string) => StyleSheet.create({
  body: {
    color: textColor,
    fontSize: 16,
    lineHeight: 24,
  },
  heading1: {
    color: textColor,
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 12,
    marginBottom: 8,
  },
  heading2: {
    color: textColor,
    fontSize: 20,
    fontWeight: 'bold',
    marginTop: 10,
    marginBottom: 6,
  },
  heading3: {
    color: textColor,
    fontSize: 18,
    fontWeight: '600',
    marginTop: 8,
    marginBottom: 4,
  },
  strong: {
    fontWeight: 'bold',
    color: textColor,
  },
  em: {
    fontStyle: 'italic',
    color: textColor,
  },
  link: {
    color: '#58a6ff',
    textDecorationLine: 'underline',
  },
  blockquote: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderLeftWidth: 3,
    borderLeftColor: '#58a6ff',
    paddingLeft: 12,
    paddingVertical: 4,
    marginVertical: 8,
  },
  code_inline: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    color: '#e6db74',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 14,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  fence: {
    backgroundColor: 'rgba(0,0,0,0.3)',
    color: '#e6e6e6',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 13,
    lineHeight: 20,
    padding: 12,
    borderRadius: 8,
    marginVertical: 8,
    overflow: 'hidden',
  },
  code_block: {
    backgroundColor: 'rgba(0,0,0,0.3)',
    color: '#e6e6e6',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 13,
    lineHeight: 20,
    padding: 12,
    borderRadius: 8,
    marginVertical: 8,
  },
  bullet_list: {
    marginVertical: 4,
  },
  ordered_list: {
    marginVertical: 4,
  },
  list_item: {
    flexDirection: 'row',
    marginVertical: 2,
  },
  bullet_list_icon: {
    color: textColor,
    marginRight: 8,
    fontSize: 16,
    lineHeight: 24,
  },
  ordered_list_icon: {
    color: textColor,
    marginRight: 8,
    fontSize: 16,
    lineHeight: 24,
  },
  bullet_list_content: {
    flex: 1,
  },
  ordered_list_content: {
    flex: 1,
  },
  paragraph: {
    marginVertical: 4,
  },
  hr: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    height: 1,
    marginVertical: 12,
  },
  table: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    borderRadius: 6,
    marginVertical: 8,
  },
  thead: {
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  th: {
    color: textColor,
    fontWeight: 'bold',
    padding: 8,
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  td: {
    color: textColor,
    padding: 8,
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  tr: {
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  s: {
    textDecorationLine: 'line-through',
    color: textColor,
  },
});
