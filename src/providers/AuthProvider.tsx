import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { isAdminProfile } from '@/domain/roles';
import type { Profile, UserRole, User } from '@/domain/types';
import { parseRecoveryLink, toRecoveryGrant, RECOVERY_PATH } from '@/lib/authLinking';
import { config } from '@/lib/config';
import { createRedirectUrl, getInitialUrl, subscribeToUrls } from '@/lib/deepLink';
import { clearPersistedQueries } from '@/lib/queryPersistence';
import { cacheStorage, prefsStorage } from '@/lib/storage';
import { authAdapter, dataSource, type AuthSession, type SignUpOutcome } from '@/repositories';

interface AuthValue {
  user: User | null;
  session: AuthSession | null;
  profile: Profile | null;
  /** True until the stored session has been restored (§23). */
  initializing: boolean;
  isAuthenticated: boolean;
  /**
   * Papel da conta em uso. Derivado de `profile.role`, nunca guardado à parte
   * (§4). Sem perfil carregado o valor é `user` — ausência de informação não é
   * permissão (§28, §29).
   */
  role: UserRole;
  /** Atalho de leitura para `role === 'admin'`. Não é estado (§4). */
  isAdmin: boolean;
  /**
   * Há uma sessão, mas ela veio de um link de recuperação e só serve para
   * trocar a senha. Enquanto for `true`, o aplicativo não abre.
   */
  recoveryPending: boolean;
  /** Mensagem de um link de recuperação inválido, para a tela explicar. */
  recoveryError: string | null;
  mode: typeof config.mode;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (params: {
    name: string;
    email: string;
    password: string;
    defaultCurrency: Profile['defaultCurrency'];
    travelStyle?: Profile['travelStyle'];
  }) => Promise<SignUpOutcome>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  /** Conclui a recuperação: grava a nova senha e libera o aplicativo. */
  completePasswordReset: (password: string) => Promise<void>;
  /** Desiste da recuperação sem trocar a senha. */
  cancelPasswordReset: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  setProfile: (profile: Profile) => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [profile, setProfileState] = useState<Profile | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [recoveryPending, setRecoveryPending] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  /**
   * De quem é o perfil que está carregado. Existe para responder "mudou de
   * conta?" sem depender de `profile`, que chega depois — e para não refazer a
   * leitura a cada renovação de token, que acontece de hora em hora.
   */
  const loadedFor = useRef<string | null>(null);

  const loadProfile = useCallback(async (userId: string) => {
    try {
      const stored = await dataSource.profile.get(userId);
      // Entre pedir e receber, a sessão pode ter mudado (logout, ou outra
      // conta). Gravar aqui um perfil que já não é o da sessão atual seria
      // mostrar dados de um usuário dentro da conta de outro.
      if (loadedFor.current !== userId) return null;
      setProfileState(stored);
      return stored;
    } catch {
      // Falha de rede ao buscar o perfil não pode derrubar a sessão nem, muito
      // menos, conceder privilégio. Sem perfil o aplicativo segue como conta
      // comum, e a próxima leitura corrige (§28, §29).
      if (loadedFor.current === userId) setProfileState(null);
      return null;
    }
  }, []);

  /**
   * O único lugar que escreve a sessão.
   *
   * Toda origem passa por aqui — restauração, login, cadastro, aviso do
   * provedor. Ter uma porta só é o que impede o aplicativo de acabar com dois
   * estados de autenticação discordando um do outro.
   */
  const applySession = useCallback(
    async (next: AuthSession | null) => {
      setSession(next);

      const nextId = next?.user.id ?? null;
      if (nextId === loadedFor.current) return; // mesma conta: token novo, nada a recarregar
      loadedFor.current = nextId;

      if (!nextId) {
        setProfileState(null);
        return;
      }
      await loadProfile(nextId);
    },
    [loadProfile],
  );

  // Restore the stored session before the first paint so the login screen never
  // flashes for an already-authenticated user (§23).
  useEffect(() => {
    let active = true;

    // A inscrição vem antes da restauração de propósito: se a sessão guardada
    // estiver vencida, o provedor avisa durante o `restore()`, e um ouvinte
    // registrado depois perderia esse aviso.
    const unsubscribe = authAdapter.onAuthStateChange((next) => {
      if (!active) return;
      void applySession(next);
    });

    (async () => {
      try {
        const restored = await authAdapter.restore();
        if (!active) return;
        if (restored) await applySession(restored);
      } catch {
        // A broken session is treated as signed-out.
      } finally {
        if (active) setInitializing(false);
      }
    })();

    return () => {
      active = false;
      unsubscribe();
    };
  }, [applySession]);

  // ------------------------------------------------------------------ recuperação
  //
  // O link do e-mail reabre o aplicativo. Como o cliente é criado com
  // `detectSessionInUrl: false` (não há barra de endereços no celular), é aqui
  // que a URL é aberta e trocada por uma sessão.
  useEffect(() => {
    let active = true;

    const handle = async (url: string | null) => {
      const link = parseRecoveryLink(url);
      if (!link || !active) return;

      if (link.kind === 'error') {
        setRecoveryError(link.message);
        setRecoveryPending(true);
        return;
      }

      const grant = toRecoveryGrant(link);
      if (!grant) return;

      try {
        const next = await authAdapter.redeemRecovery(grant);
        if (!active) return;
        setRecoveryError(null);
        // A ordem importa: marcar a pendência antes de aplicar a sessão evita
        // um quadro em que o usuário está autenticado e o aplicativo já abriu.
        setRecoveryPending(true);
        await applySession(next);
      } catch (error) {
        if (!active) return;
        setRecoveryError(
          error instanceof Error ? error.message : 'Não foi possível validar este link.',
        );
        setRecoveryPending(true);
      }
    };

    void getInitialUrl().then(handle);
    const unsubscribe = subscribeToUrls((url) => void handle(url));

    return () => {
      active = false;
      unsubscribe();
    };
  }, [applySession]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const next = await authAdapter.signIn(email, password);
      await applySession(next);
      await queryClient.invalidateQueries();
    },
    [applySession, queryClient],
  );

  const signUp = useCallback<AuthValue['signUp']>(
    async ({ name, email, password, defaultCurrency, travelStyle }) => {
      const outcome = await authAdapter.signUp(email, password, name);

      // Projeto com confirmação de e-mail ligada: a conta existe, mas ainda não
      // há sessão — e sem sessão a RLS recusa qualquer escrita no perfil. Quem
      // completa os dados é a primeira entrada, depois da confirmação.
      if (outcome.status === 'confirmation-required') return outcome;

      await applySession(outcome.session);

      // O perfil já existe: o gatilho `handle_new_user` (0001) o cria na mesma
      // transação do cadastro. Isto aqui completa o que o gatilho não tem como
      // saber — moeda e estilo de viagem vieram do formulário.
      //
      // `role` não entra no payload, e não adiantaria entrar: o gatilho
      // `profiles_no_role_escalation` (0003) recusa a troca vinda de sessão de
      // usuário.
      const completed = await dataSource.profile.update(outcome.session.user.id, {
        name,
        defaultCurrency,
        travelStyle,
      });
      if (loadedFor.current === outcome.session.user.id) setProfileState(completed);
      await queryClient.invalidateQueries();
      return outcome;
    },
    [applySession, queryClient],
  );

  /** Tudo que é do usuário e vive no aparelho. Sai junto com a sessão. */
  const clearPrivateState = useCallback(
    async (ownerId?: string) => {
    // Clears cached reads only — remote records are untouched (§99, fluxo 14).
    await cacheStorage.clearAll();
    // O cache de leitura persistido some junto. `cacheStorage.clearAll()` já o
    // apagaria por namespace; a chamada explícita existe para que mover a chave
    // no futuro não reabra um vazamento em silêncio.
    await clearPersistedQueries();
    // As cópias locais dos documentos também são dado privado: um cartão de
    // embarque que continua abrindo em modo avião depois da saída é o mesmo
    // vazamento, só que em arquivo. A D-04 pede que a exclusão remova as duas
    // pontas — esta é a de cá.
    if (ownerId) dataSource.files.purgeLocalCopies(ownerId);
    // A viagem selecionada é dado privado: mantê-la faria a próxima conta a
    // entrar neste aparelho abrir apontando para a viagem da conta anterior
    // (P-06). O registro no banco continua intacto — some só a seleção local.
    await prefsStorage.remove('currentTripId');
    queryClient.clear();
    },
    [queryClient],
  );

  const signOut = useCallback(async () => {
    const dono = session?.user.id;
    await authAdapter.signOut();
    // Zerar o perfil é o que zera o papel: como `role` é derivada e não um
    // estado separado, não existe cópia da permissão anterior para esquecer de
    // limpar. A próxima conta começa de `null`, isto é, sem privilégio (§26).
    await applySession(null);
    setRecoveryPending(false);
    setRecoveryError(null);
    await clearPrivateState(dono);
  }, [session, applySession, clearPrivateState]);

  const requestPasswordReset = useCallback(async (email: string) => {
    await authAdapter.requestPasswordReset(email, createRedirectUrl(RECOVERY_PATH));
  }, []);

  const completePasswordReset = useCallback(async (password: string) => {
    await authAdapter.updatePassword(password);
    setRecoveryPending(false);
    setRecoveryError(null);
  }, []);

  const cancelPasswordReset = useCallback(async () => {
    // A sessão do link de recuperação é uma sessão de verdade. Desistir sem
    // encerrá-la deixaria o aplicativo aberto com ela.
    await authAdapter.signOut();
    await applySession(null);
    setRecoveryPending(false);
    setRecoveryError(null);
    await clearPrivateState();
  }, [applySession, clearPrivateState]);

  const deleteAccount = useCallback(async () => {
    if (!session) return;

    // Em modo Supabase quem apaga é a Edge Function: ela remove os arquivos,
    // confere que sobrou zero e só então apaga a conta, que cascateia as
    // tabelas (P-02). Apagar as linhas aqui antes duplicaria o trabalho e, se a
    // função falhasse depois, deixaria uma conta viva sem nenhum dado.
    if (!authAdapter.ownsDataDeletion) {
      await dataSource.purgeUserData(session.user.id);
    }
    await authAdapter.deleteAccount(session);

    await applySession(null);
    await clearPrivateState(session.user.id);
  }, [session, applySession, clearPrivateState]);

  const refreshProfile = useCallback(async () => {
    if (session) await loadProfile(session.user.id);
  }, [session, loadProfile]);

  const value = useMemo<AuthValue>(
    () => ({
      user: session?.user ?? null,
      session,
      profile,
      initializing,
      // Uma sessão de recuperação autentica para trocar a senha, e só. Deixá-la
      // valer como sessão comum transformaria "recebi um e-mail" em uma forma
      // alternativa de entrar sem saber a senha.
      isAuthenticated: Boolean(session) && !recoveryPending,
      role: profile?.role ?? 'user',
      isAdmin: isAdminProfile(profile),
      recoveryPending,
      recoveryError,
      mode: config.mode,
      signIn,
      signUp,
      signOut,
      requestPasswordReset,
      completePasswordReset,
      cancelPasswordReset,
      deleteAccount,
      refreshProfile,
      setProfile: setProfileState,
    }),
    [
      session,
      profile,
      initializing,
      recoveryPending,
      recoveryError,
      signIn,
      signUp,
      signOut,
      requestPasswordReset,
      completePasswordReset,
      cancelPasswordReset,
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
