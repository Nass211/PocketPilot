import React from 'react';
import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { Message, Mode, WebSocketMessage } from '../types/messages';

export const useChat = (ws?: any) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);

  const sendPrompt = useCallback((
    content: string, 
    mode: Mode, 
    model?: string
  ) => {
    const userMsg: Message = {
      id: Date.now().toString() + '_user',
      role: 'user',
      content,
      isStreaming: false,
      timestamp: Date.now()
    };

    const assistantMsg: Message = {
      id: Date.now().toString() + '_assistant',
      role: 'assistant',
      content: '',
      isStreaming: true,
      timestamp: Date.now() + 1
    };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setIsGenerating(true);

    console.log('Sending prompt:', content);
    ws?.send({ type: 'prompt', content, mode, model });
  }, [ws]);

  const onChunk = useCallback((content: string) => {
    setMessages(prev => {
      const newMessages = [...prev];
      const lastIndex = newMessages.length - 1;
      
      if (lastIndex >= 0 && newMessages[lastIndex].role === 'assistant') {
        newMessages[lastIndex] = {
          ...newMessages[lastIndex],
          content: newMessages[lastIndex].content + content
        };
      }
      return newMessages;
    });
  }, []);

  const onDone = useCallback(() => {
    setMessages(prev => {
      const newMessages = [...prev];
      const lastIndex = newMessages.length - 1;
      
      if (lastIndex >= 0 && newMessages[lastIndex].role === 'assistant') {
        newMessages[lastIndex] = {
          ...newMessages[lastIndex],
          isStreaming: false
        };
      }
      return newMessages;
    });
    setIsGenerating(false);
  }, []);

  const onError = useCallback((code: string, message: string) => {
    setMessages(prev => {
      const newMessages = [...prev];
      const lastIndex = newMessages.length - 1;
      
      if (lastIndex >= 0 && newMessages[lastIndex].role === 'assistant') {
        const currentContent = newMessages[lastIndex].content;
        newMessages[lastIndex] = {
          ...newMessages[lastIndex],
          content: currentContent + (currentContent ? '\n\n' : '') + `[Error: ${message}]`,
          isStreaming: false
        };
      }
      return newMessages;
    });
    setIsGenerating(false);
  }, []);

  const onCancel = useCallback(() => {
    setMessages(prev => {
      const newMessages = [...prev];
      const lastIndex = newMessages.length - 1;
      
      if (lastIndex >= 0 && newMessages[lastIndex].role === 'assistant') {
        newMessages[lastIndex] = {
          ...newMessages[lastIndex],
          isStreaming: false
        };
      }
      return newMessages;
    });
    setIsGenerating(false);
  }, []);

  return {
    messages,
    isGenerating,
    sendPrompt,
    onChunk,
    onDone,
    onError,
    onCancel
  };
};
