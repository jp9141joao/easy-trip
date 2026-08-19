import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type { Profile, User } from '@/domain/types';
import { config } from '@/lib/config';
import { cacheStorage, prefsStorage } from '@/lib/storage';
import { authAdapter, dataSource, type AuthSession } from '@/repositories';

interface AuthValue {
  user: User | null;
  session: AuthSession | null;
  profile: Profile | null;
  /** True until the stored session has been restored (§23). */
  initializing: boolean;
  isAuthenticated: boolean;
  mode: typeof config.mode;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (params: {
    name: string;
    email: string;
    password: string;
    defaultCurrency: Profile['defaultCurrency'];
    travelStyle?: Profile['travelStyle'];
  }) => Promise<void>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  deleteAccount: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  setProfile: (profile: Profile) => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [profile, setProfileState] = useState<Profile | null>(null);
  const [initializing, setInitializing] = useState(true);
  const queryClient = useQueryClient();

  const loadProfile = useCallback(async (userId: string) => {
    const stored = await dataSource.profile.get(userId);
    setProfileState(stored);
    return stored;
  }, []);

  // Restore the stored session before the first paint so the login screen never
  // flashes for an already-authenticated user (§23).
  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const restored = await authAdapter.restore();
        if (!active) return;
        if (restored) {
          setSession(restored);
          await loadProfile(restored.user.id);
        }
      } catch {
        // A broken session is treated as signed-out.
      } finally {
        if (active) setInitializing(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [loadProfile]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const next = await authAdapter.signIn(email, password);
      setSession(next);
      await loadProfile(next.user.id);
      await queryClient.invalidateQueries();
    },
    [loadProfile, queryClient],
  );

  const signUp = useCallback<AuthValue['signUp']>(
    async ({ name, email, password, defaultCurrency, travelStyle }) => {
      const next = await authAdapter.signUp(email, password, name);
      setSession(next);

      // A profile always exists alongside an account, so the app never has to
      // handle a half-created user.
      const created = await dataSource.profile.upsert({
        userId: next.user.id,
        name,
        defaultCurrency,
        travelStyle,
      });
      setProfileState(created);
      await queryClient.invalidateQueries();
    },
    [queryClient],
  );

  const signOut = useCallback(async () => {
    await authAdapter.signOut();
    setSession(null);
    setProfileState(null);
    // Clears cached reads only — remote records are untouched (§99, fluxo 14).
    await cacheStorage.clearAll();
    queryClient.clear();
  }, [queryClient]);

  const requestPasswordReset = useCallback(async (email: string) => {
    await authAdapter.requestPasswordReset(email);
  }, []);

  const deleteAccount = useCallback(async () => {
    if (!session) return;
    await dataSource.purgeUserData(session.user.id);
    await authAdapter.deleteAccount(session);
    await cacheStorage.clearAll();
    await prefsStorage.remove('currentTripId');
    setSession(null);
    setProfileState(null);
    queryClient.clear();
  }, [session, queryClient]);

  const refreshProfile = useCallback(async () => {
    if (session) await loadProfile(session.user.id);
  }, [session, loadProfile]);

  const value = useMemo<AuthValue>(
    () => ({
      user: session?.user ?? null,
      session,
      profile,
      initializing,
      isAuthenticated: Boolean(session),
      mode: config.mode,
      signIn,
      signUp,
      signOut,
      requestPasswordReset,
      deleteAccount,
      refreshProfile,
      setProfile: setProfileState,
    }),
    [
      session,
      profile,
      initializing,
      signIn,
      signUp,
      signOut,
      requestPasswordReset,
      deleteAccount,
      refreshProfile,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth precisa estar dentro de <AuthProvider>');
  return context;
}

/** Convenience for repositories that require an owner id. */
export function useUserId(): string {
  const { user } = useAuth();
  if (!user) throw new Error('Nenhum usuário autenticado.');
  return user.id;
}
