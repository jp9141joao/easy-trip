import { useQueryClient } from '@tanstack/react-query';
import * as Network from 'expo-network';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/**
 * Connectivity abstraction (§98).
 *
 * When the connection comes back we invalidate every query so the screens
 * refresh instead of silently serving stale cache.
 */

export type ConnectionStatus = 'online' | 'offline' | 'reconnecting';

interface ConnectivityValue {
  status: ConnectionStatus;
  isOnline: boolean;
  isOffline: boolean;
}

const ConnectivityContext = createContext<ConnectivityValue>({
  status: 'online',
  isOnline: true,
  isOffline: false,
});

export function ConnectivityProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ConnectionStatus>('online');
  const queryClient = useQueryClient();
  const wasOffline = useRef(false);

  useEffect(() => {
    let active = true;

    const apply = (state: Network.NetworkState) => {
      if (!active) return;
      // `isInternetReachable` can be undefined on some platforms; treat an
      // unknown value as connected rather than falsely reporting offline.
      const connected = state.isConnected !== false && state.isInternetReachable !== false;

      if (connected) {
        if (wasOffline.current) {
          wasOffline.current = false;
          setStatus('reconnecting');
          void queryClient.invalidateQueries().finally(() => {
            if (active) setStatus('online');
          });
        } else {
          setStatus('online');
        }
      } else {
        wasOffline.current = true;
        setStatus('offline');
      }
    };

    void Network.getNetworkStateAsync().then(apply).catch(() => undefined);
    const subscription = Network.addNetworkStateListener(apply);

    return () => {
      active = false;
      subscription.remove();
    };
  }, [queryClient]);

  const value = useMemo<ConnectivityValue>(
    () => ({ status, isOnline: status !== 'offline', isOffline: status === 'offline' }),
    [status],
  );

  return <ConnectivityContext.Provider value={value}>{children}</ConnectivityContext.Provider>;
}

export function useConnectivity(): ConnectivityValue {
  return useContext(ConnectivityContext);
}
