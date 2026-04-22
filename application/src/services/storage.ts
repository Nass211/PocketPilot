import AsyncStorage from '@react-native-async-storage/async-storage';
import { CONSTANTS } from '../constants';

export interface SavedConnection {
  url: string;
  localUrl: string;
  token: string;
  label: string;
  lastUsed: number;
}

export interface Preferences {
  defaultMode: string;
  defaultModel: string;
}

export const StorageService = {
  saveConnection: async (conn: SavedConnection): Promise<void> => {
    try {
      const connections = await StorageService.getAllConnections();
      
      // Update existing or add new
      const filtered = connections.filter(c => c.url !== conn.url && c.localUrl !== conn.localUrl);
      filtered.unshift({ ...conn, lastUsed: Date.now() });
      
      // Keep only last 10 connections
      const recentConnections = filtered.slice(0, 10);
      
      await AsyncStorage.multiSet([
        [CONSTANTS.STORAGE_KEYS.ALL_CONNECTIONS, JSON.stringify(recentConnections)],
        [CONSTANTS.STORAGE_KEYS.LAST_CONNECTION, JSON.stringify(conn)]
      ]);
    } catch (e) {
      if (__DEV__) console.error('Failed to save connection', e);
    }
  },

  getLastConnection: async (): Promise<SavedConnection | null> => {
    try {
      const data = await AsyncStorage.getItem(CONSTANTS.STORAGE_KEYS.LAST_CONNECTION);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      if (__DEV__) console.error('Failed to get last connection', e);
      return null;
    }
  },

  getAllConnections: async (): Promise<SavedConnection[]> => {
    try {
      const data = await AsyncStorage.getItem(CONSTANTS.STORAGE_KEYS.ALL_CONNECTIONS);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      if (__DEV__) console.error('Failed to get all connections', e);
      return [];
    }
  },

  deleteConnection: async (url: string): Promise<void> => {
    try {
      const connections = await StorageService.getAllConnections();
      const filtered = connections.filter(c => c.url !== url && c.localUrl !== url);
      
      await AsyncStorage.setItem(CONSTANTS.STORAGE_KEYS.ALL_CONNECTIONS, JSON.stringify(filtered));
      
      // Reset last connection if it was the deleted one
      const last = await StorageService.getLastConnection();
      if (last && (last.url === url || last.localUrl === url)) {
        await AsyncStorage.removeItem(CONSTANTS.STORAGE_KEYS.LAST_CONNECTION);
        if (filtered.length > 0) {
           await AsyncStorage.setItem(CONSTANTS.STORAGE_KEYS.LAST_CONNECTION, JSON.stringify(filtered[0]));
        }
      }
    } catch (e) {
      if (__DEV__) console.error('Failed to delete connection', e);
    }
  },

  savePreferences: async (prefs: Preferences): Promise<void> => {
    try {
      await AsyncStorage.setItem(CONSTANTS.STORAGE_KEYS.PREFERENCES, JSON.stringify(prefs));
    } catch (e) {
      if (__DEV__) console.error('Failed to save preferences', e);
    }
  },

  getPreferences: async (): Promise<Preferences> => {
    try {
      const data = await AsyncStorage.getItem(CONSTANTS.STORAGE_KEYS.PREFERENCES);
      if (data) return JSON.parse(data);
    } catch (e) {
      if (__DEV__) console.error('Failed to get preferences', e);
    }
    return { defaultMode: CONSTANTS.DEFAULT_MODE, defaultModel: CONSTANTS.DEFAULT_MODEL };
  }
};