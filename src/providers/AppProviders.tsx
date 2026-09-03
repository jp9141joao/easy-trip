import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ToastProvider } from '@/components/ui';
import { ThemeProvider, useTheme } from '@/theme';
import { AuthProvider } from './AuthProvider';
import { ConnectivityProvider } from './ConnectivityProvider';
import { QueryPersistence } from './QueryPersistence';
import { TripSelectionProvider } from './TripSelectionProvider';

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Records change from this device most of the time, so a short stale
        // window avoids refetch storms while keeping screens current.
        staleTime: 30_000,
        gcTime: 30 * 60_000,
        retry: (failureCount) => failureCount < 2,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: 0 },
    },
  });
}

/**
 * Provider order matters:
 * QueryClient must wrap Connectivity (which invalidates queries on reconnect)
 * and Auth (which clears the cache on sign-out).
 */
export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <RootBackground>
            <ToastProvider>
              <ConnectivityProvider>
                <AuthProvider>
                  <QueryPersistence />
                  <TripSelectionProvider>{children}</TripSelectionProvider>
                </AuthProvider>
              </ConnectivityProvider>
            </ToastProvider>
          </RootBackground>
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

/**
 * A primeira superfície opaca da aplicação (§15).
 *
 * Acima daqui só existem providers de contexto — nenhum deles pinta nada — e,
 * abaixo da árvore React, a view raiz nativa. Enquanto ninguém declarasse uma
 * cor neste ponto, qualquer frame em que a navegação ainda não tivesse uma tela
 * desenhada caía direto no fundo da janela, que no Android é claro.
 *
 * É a rede por baixo das outras duas correções, não a correção principal: o
 * tema do navegador e o `sceneStyle` das abas resolvem a origem do branco. Esta
 * view garante que nenhum caminho futuro — um provider que renderize algo fora
 * do navegador, uma tela montando antes da primeira pintura — reabra o mesmo
 * buraco.
 */
function RootBackground({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <View style={{ flex: 1, backgroundColor: theme.colors.background }}>{children}</View>;
}
