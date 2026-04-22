import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type Theme = 'dark' | 'light';

export interface ThemeColors {
  background: string;
  surface: string;
  text: string;
  textSecondary: string;
  border: string;
  userBubble: string;
  assistantBubble: string;
  assistantText: string;
  inputBackground: string;
  accent: string;
}

const darkColors: ThemeColors = {
  background: '#000000',
  surface: '#121212',
  text: '#ffffff',
  textSecondary: '#888888',
  border: '#333333',
  userBubble: '#0078d4',
  assistantBubble: '#ffffff',
  assistantText: '#000000',
  inputBackground: '#2d2d2d',
  accent: '#ff6b35',
};

const lightColors: ThemeColors = {
  background: '#f5f5f5',
  surface: '#ffffff',
  text: '#000000',
  textSecondary: '#666666',
  border: '#dddddd',
  userBubble: '#0078d4',
  assistantBubble: '#ffffff',
  assistantText: '#000000',
  inputBackground: '#eeeeee',
  accent: '#ff6b35',
};

interface ThemeContextProps {
  theme: Theme;
  colors: ThemeColors;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextProps | undefined>(undefined);

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [theme, setTheme] = useState<Theme>('dark');
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const storedTheme = await AsyncStorage.getItem('@pocketpilot_theme');
        if (storedTheme === 'dark' || storedTheme === 'light') {
          setTheme(storedTheme as Theme);
        }
      } catch (e) {
        console.error("Error loading theme:", e);
      } finally {
        setIsLoaded(true);
      }
    })();
  }, []);

  const toggleTheme = async () => {
    try {
      const newTheme = theme === 'dark' ? 'light' : 'dark';
      setTheme(newTheme);
      await AsyncStorage.setItem('@pocketpilot_theme', newTheme);
    } catch (e) {
      console.error("Error saving theme:", e);
    }
  };

  if (!isLoaded) return null;

  const colors = theme === 'dark' ? darkColors : lightColors;

  return (
    <ThemeContext.Provider value={{ theme, colors, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
