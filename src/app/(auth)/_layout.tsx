import { Redirect, Stack } from 'expo-router';

import { useAuth } from '@/providers/AuthProvider';

export default function AuthLayout() {
  const { isAuthenticated } = useAuth();

  // Someone already signed in has no business on the login stack.
  if (isAuthenticated) return <Redirect href="/(tabs)" />;

  return <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />;
}
