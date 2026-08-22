import { Redirect, Stack } from 'expo-router';

import { useAuth } from '@/providers/AuthProvider';
import { useTheme } from '@/theme';

export default function AuthLayout() {
  const { isAuthenticated, recoveryPending } = useAuth();
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
    >
      {/*
        Quem chegou por um link de recuperação tem uma sessão válida — só que
        ela serve para uma coisa só. Enquanto a senha não for trocada, entrar ou
        cadastrar saem de cena: sem isso, o link do e-mail viraria uma forma de
        usar o aplicativo sem saber a senha.
      */}
      <Stack.Protected guard={recoveryPending}>
        <Stack.Screen name="reset-password" />
      </Stack.Protected>

      <Stack.Protected guard={!recoveryPending}>
        <Stack.Screen name="login" />
        <Stack.Screen name="register" />
        <Stack.Screen name="forgot-password" />
      </Stack.Protected>
    </Stack>
  );
}
