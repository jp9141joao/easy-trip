import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ToastProvider } from '@/components/ui';
import { ThemeProvider } from '@/theme';
import { AuthProvider } from './AuthProvider';
import { ConnectivityProvider } from './ConnectivityProvider';
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
          <ToastProvider>
            <ConnectivityProvider>
              <AuthProvider>
                <TripSelectionProvider>{children}</TripSelectionProvider>
              </AuthProvider>
            </ConnectivityProvider>
          </ToastProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
