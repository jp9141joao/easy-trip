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
import { Stack, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useReminderDelivery, useRevokedTripCleanup } from '@/hooks/useNotifications';
import { AppProviders } from '@/providers/AppProviders';
import { useAuth } from '@/providers/AuthProvider';
import { useTheme, useThemePreference } from '@/theme';

// Hold the splash until fonts are loaded and the session has been restored, so
// the login screen never flashes for a signed-in user (§23).
void SplashScreen.preventAutoHideAsync();

/**
 * Rede de segurança de renderização (F10, §52).
 *
 * O Expo Router chama este componente exportado quando qualquer tela abaixo da
 * raiz lança durante a renderização. Sem ele, em build de produção, um erro de
 * render desmonta a árvore e deixa a tela **preta e sem explicação** — o usuário
 * não sabe se o aplicativo travou, se está carregando ou se deve reinstalar.
 *
 * O que ele não faz, de propósito: relatar o erro para fora. Não há serviço de
 * telemetria neste projeto, e inventar um enviaria dados de viagem de alguém
 * para um terceiro. A mensagem técnica fica na tela, onde ajuda a diagnosticar,
 * e o botão refaz a montagem — que resolve o caso comum, um estado transitório.
 *
 * `useTheme` não é usado aqui: se o erro tiver vindo de dentro dos providers,
 * eles podem não estar montados, e um hook de contexto lançaria dentro do
 * próprio tratamento de erro. As cores são fixas, no tema escuro do produto.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        padding: 32,
        backgroundColor: '#0B1120',
      }}
    >
      <Text style={{ color: '#F8FAFC', fontSize: 20, fontWeight: '700', textAlign: 'center' }}>
        Algo deu errado
      </Text>
      <Text style={{ color: '#94A3B8', fontSize: 14, textAlign: 'center', lineHeight: 20 }}>
        O Easy Trip encontrou um erro inesperado nesta tela. Seus dados continuam salvos.
      </Text>
      <Text
        style={{ color: '#64748B', fontSize: 12, textAlign: 'center' }}
        numberOfLines={4}
        selectable
      >
        {error.message}
      </Text>
      <Pressable
        onPress={retry}
        accessibilityRole="button"
        accessibilityLabel="Tentar novamente"
        style={{
          minHeight: 48,
          justifyContent: 'center',
          paddingHorizontal: 24,
          borderRadius: 16,
          backgroundColor: '#6366F1',
        }}
      >
        <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '600' }}>Tentar novamente</Text>
      </Pressable>
    </View>
  );
}

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
  const { initializing, isAuthenticated } = useAuth();
  const { hydrated } = useThemePreference();

  /**
   * Os lembretes vencidos viram notificação quando o aplicativo abre.
   *
   * Mora na raiz porque é a única posição que garante que a entrega aconteça
   * independentemente de por qual tela a pessoa entrou — e porque a Central
   * precisa já estar preenchida quando ela tocar no sino. O hook roda uma vez
   * por sessão, não a cada render.
   *
   * Isto NÃO é push do sistema (§33). Ver `useReminderDelivery`.
   */
  useReminderDelivery();

  /**
   * Quem perdeu acesso a uma viagem não continua com ela em disco (§59).
   */
  useRevokedTripCleanup();

  // A preferência de aparência entra na mesma barreira da sessão: enquanto o
  // tema salvo não foi lido do disco, o splash continua cobrindo a tela. É isso
  // que evita a sequência "abre no tema do sistema → troca para o tema
  // escolhido" ficar visível na inicialização (§2).
  const ready = !initializing && hydrated;

  const hideSplash = useCallback(async () => {
    await SplashScreen.hideAsync().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (ready) void hideSplash();
  }, [ready, hideSplash]);

  if (!ready) {
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
        {/*
          A proteção de rota vive aqui, e não espalhada pelas telas.

          `Stack.Protected` não esconde a tela: ela sai do estado de navegação.
          A diferença aparece no logout — com um `if` dentro da tela, o histórico
          continua existindo e o botão "voltar" leva de volta ao que já não
          deveria ser acessível. Removendo a rota, não há para onde voltar.

          Toda rota privada precisa estar listada no bloco de baixo. É uma lista
          manual, e listas manuais são esquecidas: `tests/unit/route-guard.test.ts`
          lê o diretório `src/app` e falha se aparecer uma rota nova que ninguém
          classificou.
        */}
        <Stack.Screen name="index" />

        <Stack.Protected guard={!isAuthenticated}>
          <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
          <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
        </Stack.Protected>

        <Stack.Protected guard={isAuthenticated}>
          <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
          <Stack.Screen
            name="alerts"
            options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
          />
          <Stack.Screen name="trip" />
          <Stack.Screen name="trips" />
          <Stack.Screen name="profile" />
          <Stack.Screen name="utilities" />
          <Stack.Screen name="community" />
          <Stack.Screen name="offers" />
          <Stack.Screen name="places" />
          <Stack.Screen name="admin" />
        </Stack.Protected>
      </Stack>
    </>
  );
}
