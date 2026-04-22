export const CONSTANTS = {
  WS_AUTH_TIMEOUT: 5000,
  WS_PING_INTERVAL: 5000,
  WS_PONG_TIMEOUT: 10000,
  RECONNECT_DELAYS: [1000, 2000, 4000, 8000, 30000],
  MAX_RECONNECT_ATTEMPTS: 10,
  STORAGE_KEYS: {
    LAST_CONNECTION: '@pocketpilot:last_connection',
    ALL_CONNECTIONS: '@pocketpilot:connections',
    PREFERENCES: '@pocketpilot:preferences',
  },
  MODELS: ['auto', 'GPT-4o', 'GPT-4.1', 'GPT-4.1-mini', 'claude-sonnet-4', 'o3', 'o4-mini'],
  MODES: ['ask', 'agent', 'plan'],
  DEFAULT_MODE: 'ask',
  DEFAULT_MODEL: 'auto',
  COLORS: {
    background: '#1E1E1E',
    surface: '#2D2D2D',
    primary: '#C1440E',
    success: '#4CAF50',
    warning: '#FF9800',
    danger: '#F44336',
    text: '#FFFFFF',
    textMuted: '#888888',
    border: '#444444'
  }
};