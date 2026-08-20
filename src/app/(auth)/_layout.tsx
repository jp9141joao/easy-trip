import { Redirect, Stack } from 'expo-router';

import { useAuth } from '@/providers/AuthProvider';
import { useTheme } from '@/theme';

export default function AuthLayout() {
  const { isAuthenticated } = useAuth();
  const theme = useTheme();

  // Someone already signed in has no business on the login stack.
  if (isAuthenticated) return <Redirect href="/(tabs)" />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        // Mesmo motivo do stack da viagem: sem background explícito, o
        // container do navegador aparece durante a transição (§15).
        contentStyle: { backgroundColor: theme.colors.background },
      }}
    />
  );
}
