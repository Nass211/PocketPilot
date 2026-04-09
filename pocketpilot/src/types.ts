// ── Phone → Extension ──────────────────────────────────────────────

export type IncomingMessage =
    | { type: 'auth'; token: string }
    | { type: 'pong' }
    | { type: 'prompt'; content: string; mode: 'ask' | 'agent' | 'plan' }
    | { type: 'permission'; id: string; decision: 'allow' | 'allow_session' | 'allow_all' | 'deny' }
    | { type: 'user_input'; answer: string }
    | { type: 'action'; action: 'start_implementation' | 'revise_plan' | 'cancel' | 'accept_diff' | 'reject_diff'; diffId?: string }
    | { type: 'switch_model'; model: string }
    | { type: 'switch_mode'; mode: 'ask' | 'agent' | 'plan' }
    | { type: 'clear_history' }
    | { type: 'get_workspace_info' }
    | { type: 'cancel_task' };

// ── Extension → Phone ──────────────────────────────────────────────

export interface ActionButton {
    id: string;
    label: string;
    style: 'primary' | 'secondary' | 'danger';
}

export type OutgoingMessage =
    | { type: 'ping' }
    | { type: 'connected'; project: string; branch: string; model: string; mode: string; hasHistory: boolean }
    | { type: 'chunk'; content: string }
    | { type: 'done' }
    | { type: 'permission_request'; id: string; kind: string; command: string }
    | { type: 'user_input_request'; question: string; choices?: string[] }
    | { type: 'action_required'; actions: ActionButton[] }
    | { type: 'diff'; id: string; file: string; before: string; after: string }
    | { type: 'workspace_info'; project: string; branch: string; files: string[] }
    | { type: 'model_switched'; model: string }
    | { type: 'mode_switched'; mode: string }
    | { type: 'error'; code: string; message: string }
    | { type: 'cli_status'; status: 'running' | 'crashed' | 'reconnecting' }
    | { type: 'notification'; title: string; body: string };
