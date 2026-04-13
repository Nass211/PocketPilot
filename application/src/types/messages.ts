export type Role = 'user' | 'assistant';

export interface Message {
  id: string;
  role: Role;
  content: string;
  isStreaming: boolean;
  timestamp: number;
}

export type Mode = 'ask' | 'agent' | 'plan';
export type Decision = 'allow' | 'allow_session' | 'allow_all' | 'deny';
export type Action = 'start_implementation' | 'revise_plan' | 'cancel';

export interface WebSocketMessage {
  type: string;
  [key: string]: any;
}
