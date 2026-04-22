import React from 'react';
import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { WebSocketService } from '../services/websocket';
import { WebSocketMessage } from '../types/messages';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'authenticating' | 'connected' | 'reconnecting';
export type CliStatus = 'running' | 'crashed' | 'reconnecting' | 'unknown';

import { PermissionRequestPayload } from '../components/PermissionModal';
import { UserInputRequestPayload } from '../components/UserInputModal';
import { ActionButtonPayload } from '../components/ActionButtons';

export interface WebSocketCallbacks {
  onChunk?: (content: string) => void;
  onDone?: () => void;
  onError?: (code: string, message: string) => void;
  onPermissionRequest?: (data: PermissionRequestPayload) => void;
  onUserInputRequest?: (data: UserInputRequestPayload) => void;
  onActionRequired?: (data: ActionButtonPayload[]) => void;
  onNotification?: (data: any) => void;
}

export function useWebSocket(initialCallbacks: WebSocketCallbacks = {}) {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [project, setProject] = useState<string>('');
  const [branch, setBranch] = useState<string>('');
  const [model, setModel] = useState<string>('');
  const [mode, setMode] = useState<string>('');
  const [hasHistory, setHasHistory] = useState<boolean>(false);
  const [cliStatus, setCliStatus] = useState<CliStatus>('unknown');

  const wsRef = useRef<WebSocketService | null>(null);
  
  // Dynamic callbacks referencing
  const callbacksRef = useRef<WebSocketCallbacks>(initialCallbacks);

  const connect = useCallback((url: string, token: string) => {
    setStatus('connecting');
    
    wsRef.current = new WebSocketService({
      url,
      token,
      onStatusChange: (wsStatus) => {
        if (wsStatus === 'connected') {
          setStatus('authenticating'); 
        } else if (wsStatus === 'error') {
           setStatus((prev) => prev !== 'disconnected' ? 'reconnecting' : 'disconnected');
        } else {
          setStatus(wsStatus as ConnectionStatus);
        }
      },
      onMessage: (msg: WebSocketMessage) => {
        if (msg.type === 'ping') {
          wsRef.current?.send({ type: 'pong' });
          return;
        }
        
        switch (msg.type) {
          case 'connected':
            setStatus('connected');
            if (msg.project) setProject(msg.project);
            if (msg.branch) setBranch(msg.branch);
            if (msg.model) setModel(msg.model);
            if (msg.mode) setMode(msg.mode);
            if (msg.hasHistory !== undefined) setHasHistory(msg.hasHistory);
            break;
          case 'cli_status':
            setCliStatus(msg.status as CliStatus);
            break;
          case 'chunk':
          case 'chat_updated':
            callbacksRef.current.onChunk?.(msg.content);
            break;
          case 'done':
            callbacksRef.current.onDone?.();
            break;
          case 'error':
            callbacksRef.current.onError?.(msg.code, msg.message);
            break;
          case 'permission_request':
            callbacksRef.current.onPermissionRequest?.(msg as any as PermissionRequestPayload);
            break;
          case 'user_input_request':
            callbacksRef.current.onUserInputRequest?.(msg as any as UserInputRequestPayload);
            break;
          case 'action_required':
            callbacksRef.current.onActionRequired?.(msg.actions as ActionButtonPayload[]);
            break;
          case 'notification':
            callbacksRef.current.onNotification?.(msg);
            break;
        }
      }
    });

    wsRef.current.connect();
  }, []);

  const disconnect = useCallback(() => {
    wsRef.current?.disconnect();
    wsRef.current = null;
    setStatus('disconnected');
    setProject('');
    setBranch('');
    setCliStatus('unknown');
  }, []);

  const send = useCallback((message: WebSocketMessage) => {
    wsRef.current?.send(message);
  }, []);

  // Update callbacks dynamically without reconnecting
  const setCallbacks = (callbacks: WebSocketCallbacks) => {
    callbacksRef.current = callbacks;
  };

  return {
    status,
    project,
    branch,
    model,
    mode,
    hasHistory,
    cliStatus,
    connect,
    disconnect,
    send,
    callbacksRef
  };
};
