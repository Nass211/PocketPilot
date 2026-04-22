import React, { createContext, useContext } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';

const AppContext = createContext<ReturnType<typeof useWebSocket> | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const ws = useWebSocket();
  return (
    <AppContext.Provider value={ws}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useAppContext must be used within AppProvider');
  return context;
}