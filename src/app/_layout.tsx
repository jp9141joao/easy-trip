import {
  JetBrainsMono_500Medium,
  JetBrainsMono_700Bold,
} from '@expo-google-fonts/jetbrains-mono';
import { Outfit_600SemiBold, Outfit_700Bold } from '@expo-google-fonts/outfit';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect } from 'react';
import { View } from 'react-native';

import { AppProviders } from '@/providers/AppProviders';
import { useAuth } from '@/providers/AuthProvider';
import { useTheme } from '@/theme';

// Hold the splash until fonts are loaded and the session has been restored, so
// the login screen never flashes for a signed-in user (§23).
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    Outfit_600SemiBold,
    Outfit_700Bold,
    JetBrainsMono_500Medium,
    JetBrainsMono_700Bold,
  });

  // A font that fails to download must not brick the app — the system face is
  // an acceptable fallback, so we proceed either way.
  const ready = fontsLoaded || Boolean(fontError);

  if (!ready) return null;

  return (
    <AppProviders>
      <RootNavigator />
    </AppProviders>
  );
}

function RootNavigator() {
  const theme = useTheme();
  const { initializing } = useAuth();

  const hideSplash = useCallback(async () => {
    await SplashScreen.hideAsync().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!initializing) void hideSplash();
  }, [initializing, hideSplash]);

  if (initializing) {
    // Splash is still covering the screen; render the brand colour underneath
    // so there is no white flash as it fades.
    return <View style={{ flex: 1, backgroundColor: theme.colors.background }} />;
  }

  return (
    <>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.background },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
        <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
        <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
        <Stack.Screen name="alerts" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      </Stack>
    </>
  );
}
