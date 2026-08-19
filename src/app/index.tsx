import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { prefsStorage } from '@/lib/storage';
import { useAuth } from '@/providers/AuthProvider';
import { useTheme } from '@/theme';

const ONBOARDING_KEY = 'onboardingSeen';

/**
 * Boot router (§99, fluxo 1).
 *
 * Decides where the app opens: onboarding on first launch, the auth stack when
 * signed out, and the dashboard when a session was restored.
 */
export default function BootScreen() {
  const theme = useTheme();
  const { isAuthenticated } = useAuth();
  const [seenOnboarding, setSeenOnboarding] = useState<boolean | null>(null);

  useEffect(() => {
    void prefsStorage.get<boolean>(ONBOARDING_KEY, false).then(setSeenOnboarding);
  }, []);

  if (seenOnboarding === null) {
    return <View style={{ flex: 1, backgroundColor: theme.colors.background }} />;
  }

  if (!seenOnboarding) return <Redirect href="/onboarding" />;
  if (!isAuthenticated) return <Redirect href="/(auth)/login" />;
  return <Redirect href="/(tabs)" />;
}

export { ONBOARDING_KEY };
