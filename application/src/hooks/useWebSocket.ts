import React from 'react';
import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { WebSocketService } from '../services/websocket';
import { WebSocketMessage } from '../types/messages';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'authenticating' | 'connected' | 'reconnecting';
export type CliStatus = 'running' | 'crashed' | 'reconnecting' | 'unknown';

export interface AvailableModel {
  id: string;
  displayName: string;
  vendor: string;
}

export interface ModifiedFile {
  file: string;
  additions: number;
  deletions: number;
  diff: string;
}

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
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [activity, setActivity] = useState<string>('');
  const [modifiedFiles, setModifiedFiles] = useState<ModifiedFile[]>([]);

  const wsRef = useRef<WebSocketService | null>(null);
  
  // Dynamic callbacks referencing
  const callbacksRef = useRef<WebSocketCallbacks>(initialCallbacks);

  const connect = useCallback((url: string, token: string, localUrl?: string, tunnelUrl?: string) => {
    setStatus('connecting');
    
    wsRef.current = new WebSocketService({
      url,
      token,
      localUrl,
      tunnelUrl,
      onStatusChange: (wsStatus) => {
        if (wsStatus === 'connected') {
          // TCP socket is open, auth message sent — wait for { type: 'connected' } from extension
          setStatus('authenticating'); 
        } else if (wsStatus === 'error') {
           setStatus((prev) => prev !== 'disconnected' ? 'reconnecting' : 'disconnected');
        } else {
          setStatus(wsStatus as ConnectionStatus);
        }
      },
      onMessage: (msg: WebSocketMessage) => {
        // Note: 'ping' messages are already handled in WebSocketService.handleMessage()
        // and are never forwarded here.
        
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
            // Handle both real extension ('chunk') and mock server ('chat_updated')
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
          case 'model_switched':
            if (msg.model) setModel(msg.model);
            break;
          case 'mode_switched':
            if (msg.mode) setMode(msg.mode);
            break;
          case 'workspace_info':
            // Available for future use — no action needed
            break;
          case 'diff':
            // Future feature — no action needed
            break;
          case 'models_available':
            if (msg.models && Array.isArray(msg.models)) {
              setAvailableModels(msg.models);
            }
            break;
          case 'activity':
            setActivity(msg.label || '');
            break;
          case 'files_modified':
            if (msg.files && Array.isArray(msg.files)) {
              setModifiedFiles(msg.files);
            }
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
    availableModels,
    activity,
    modifiedFiles,
    clearModifiedFiles: () => setModifiedFiles([]),
    connect,
    disconnect,
    send,
    callbacksRef
  };
};
