import React from 'react';
import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { Message, MessageAttachment, Mode, WebSocketMessage } from '../types/messages';

export const useChat = (ws?: any) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);

  const sendPrompt = useCallback((
    content: string, 
    mode: Mode, 
    model?: string,
    attachments?: MessageAttachment[]
  ) => {
    const userMsg: Message = {
      id: Date.now().toString() + '_user',
      role: 'user',
      content,
      isStreaming: false,
      timestamp: Date.now(),
      attachments,
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

    // Convert all attachments (images, PDFs, text files, etc.) to base64 before
    // sending — local file URIs are not accessible on the extension side.
    const prepareAttachments = async () => {
      if (!attachments || attachments.length === 0) return undefined;
      const prepared = await Promise.all(
        attachments.map(async (a) => {
          try {
            const response = await fetch(a.uri);
            const blob = await response.blob();
            const base64: string = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
            // base64 is "data:<mime>;base64,..." — strip the prefix for the extension
            const rawBase64 = base64.split(',')[1] || base64;
            return { name: a.name, mimeType: a.mimeType, data: rawBase64 };
          } catch {
            return { name: a.name, mimeType: a.mimeType, data: null };
          }
        })
      );
      return prepared.filter(a => a.data !== null);
    };

    prepareAttachments().then((prepared) => {
      ws?.send({
        type: 'prompt',
        content,
        mode,
        model,
        attachments: prepared && prepared.length > 0 ? prepared : undefined,
      });
    });
  }, [ws]);

  const onChunk = useCallback((content: string) => {
    // Ensure isGenerating is true — handles chunks from server-initiated
    // prompts (e.g. "Start Implementation" action) where sendPrompt() was
    // never called on the phone side.
    setIsGenerating(true);

    setMessages(prev => {
      const newMessages = [...prev];
      const lastIndex = newMessages.length - 1;
      
      if (lastIndex >= 0 && newMessages[lastIndex].role === 'assistant') {
        newMessages[lastIndex] = {
          ...newMessages[lastIndex],
          content: newMessages[lastIndex].content + content
        };
      } else {
        // No assistant bubble exists yet (action-triggered prompt) — create one
        newMessages.push({
          id: Date.now().toString() + '_assistant',
          role: 'assistant',
          content,
          isStreaming: true,
          timestamp: Date.now(),
        });
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

  const clearHistory = useCallback(() => {
    setMessages([]);
    setIsGenerating(false);
  }, []);

  return {
    messages,
    isGenerating,
    sendPrompt,
    onChunk,
    onDone,
    onError,
    onCancel,
    clearHistory
  };
};
