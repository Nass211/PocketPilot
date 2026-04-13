import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import ConnectScreen from './screens/ConnectScreen';
import ChatScreen from './screens/ChatScreen';
import SettingsScreen from './screens/SettingsScreen';
import { AppProvider } from './context/AppContext';
import { ThemeProvider, useTheme } from './context/ThemeContext';

const Stack = createNativeStackNavigator();

function RootNavigator() {
  const { colors, theme } = useTheme();

  return (
    <>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} backgroundColor={colors.surface} />
      <NavigationContainer>
        <Stack.Navigator initialRouteName="Connect"
          screenOptions={{
            headerStyle: { backgroundColor: colors.surface },
            headerTintColor: colors.text,
          }}>
          <Stack.Screen name="Connect" component={ConnectScreen}
            options={{ title: 'PocketPilot' }} />
          <Stack.Screen name="Chat" component={ChatScreen}
            options={{ headerShown: false }} />
          <Stack.Screen name="Settings" component={SettingsScreen}
            options={{ title: 'Paramètres' }} />
        </Stack.Navigator>
      </NavigationContainer>
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppProvider>
        <RootNavigator />
      </AppProvider>
    </ThemeProvider>
  );
}
