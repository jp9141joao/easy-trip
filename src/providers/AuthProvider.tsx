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
import { traceAuth } from '@/lib/authTrace';
import { parseRecoveryLink, toRecoveryGrant, RECOVERY_PATH } from '@/lib/authLinking';
import { config } from '@/lib/config';
import { createRedirectUrl, getInitialUrl, subscribeToUrls } from '@/lib/deepLink';
import { clearAITripContext } from '@/lib/aiTripContext';
import { setMirrorViewer } from '@/lib/fileMirror';
import { clearPersistedQueries, invalidateQueryHydrations } from '@/lib/queryPersistence';
import { closeSharedRealtimeChannels } from '@/lib/realtimeChannel';
import { clearRecoveryMark, readRecoveryMark, writeRecoveryMark } from '@/lib/recoveryState';
import { clearTripSelection } from '@/lib/tripSelectionStorage';
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

  /** Uma saída de cada vez. Chamadas concorrentes compartilham a mesma promessa. */
  const signingOut = useRef<Promise<void> | null>(null);

  /**
   * Eventos do provedor ficam suspensos apenas enquanto a remoção local ainda
   * não foi comprovada. Depois disso outras identidades legítimas podem ser
   * anunciadas normalmente; quem continua bloqueado é a identidade que saiu.
   */
  const acceptPassiveSessions = useRef(true);

  /**
   * Identidades que saíram explicitamente nesta execução do provider.
   *
   * É um conjunto, não "a conta atual": A pode sair, B entrar e um evento
   * tardio de A ainda precisa continuar inválido. Uma entrada explícita de A
   * remove seu tombstone porque representa uma nova decisão da pessoa.
   */
  const signedOutUserIds = useRef(new Set<string>());

  /**
   * A recuperação está em curso NESTE instante?
   *
   * O `useState` correspondente é assíncrono: entre `setRecoveryPending(true)` e
   * o próximo render cabe um evento do provedor. Quem decide se uma sessão
   * recém-aplicada é "de recuperação" precisa de um valor que já valha na mesma
   * linha em que foi escrito — por isso a duplicata em `ref`.
   */
  const recoveryActive = useRef(false);

  /**
   * Contador de operações de sessão.
   *
   * Toda leitura assíncrona guarda o valor de quando começou e o confere antes
   * de aplicar o que leu. Uma restauração lenta que volte depois de um logout
   * carrega uma geração vencida, e é descartada em vez de sobrescrever o
   * estado atual.
   */
  const generation = useRef(0);

  /**
   * Entra em recuperação — em memória e em disco, nesta ordem.
   *
   * Síncrono no que importa: `recoveryActive` e o estado do React mudam antes
   * de qualquer `await`, para que nenhuma sessão anunciada durante o resgate
   * chegue a valer como entrada normal. A gravação em disco vai atrás e é o que
   * faz o fluxo sobreviver a um reinício (§7 do handoff).
   */
  const enterRecovery = useCallback((userId?: string) => {
    recoveryActive.current = true;
    setRecoveryPending(true);
    void writeRecoveryMark(userId ? { userId } : {});
  }, []);

  /** Sai da recuperação. A marca em disco só sai junto — nunca antes. */
  const leaveRecovery = useCallback(async () => {
    recoveryActive.current = false;
    setRecoveryPending(false);
    setRecoveryError(null);
    await clearRecoveryMark();
  }, []);

  /**
   * Tudo que é do usuário e vive no aparelho. Sai junto com a sessão.
   *
   * As operações em disco são independentes e concorrentes: uma ponte travada
   * ao apagar cache não segura seleção/arquivos, nem o retorno da UI. Todas as
   * chaves carregam `ownerId`, então uma promise antiga de A pode terminar
   * depois do login de B sem alcançar qualquer escrita de B.
   */
  const clearPrivateState = useCallback(
    (ownerId?: string) => {
      traceAuth('CLEANUP_BEGIN');

      /*
       * O cache em memória primeiro: é ele que alimenta as telas, e enquanto
       * existir há uma janela em que uma tela ainda desenha dado da conta que
       * acabou de sair.
       *
       * `queryClient.clear()` é a única operação daqui que NÃO é endereçada por
       * conta — ela zera o cache inteiro. Por isso a condição: se outra conta já
       * está aplicada quando esta limpeza roda, o que há no cache é dela, e uma
       * limpeza atrasada de A não pode apagar o que B acabou de carregar (§9,
       * §10 do handoff). O resto do estado de A continua sendo removido logo
       * abaixo, porque tudo lá leva `ownerId` na chave.
       */
      const currentOwner = loadedFor.current;
      if (!currentOwner || currentOwner === ownerId) {
        try {
          queryClient.clear();
        } catch {
          // As limpezas persistidas abaixo continuam mesmo se o cache em memória
          // tiver sido desmontado por outra árvore React no mesmo instante.
        }
      }

      if (!ownerId) {
        traceAuth('CLEANUP_END');
        return;
      }

      // Nunca há clearAll/remove global. Cada promise começa agora e nenhuma
      // espera a anterior, de modo que uma operação local pendurada não impede
      // as demais de remover seus próprios dados.
      void Promise.allSettled([
        clearPersistedQueries(ownerId),
        clearTripSelection(ownerId),
        clearAITripContext(ownerId),
        dataSource.files.purgeLocalCopies(ownerId),
      ]).then(() => traceAuth('CLEANUP_END'));
    },
    [queryClient],
  );

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
    async (next: AuthSession | null, bornAt = generation.current) => {
      // Chegou tarde: outra operação de sessão aconteceu enquanto esta leitura
      // estava no ar. O que ela traz já não descreve o presente.
      if (bornAt !== generation.current) return;
      // Eventos de uma identidade que saiu não ressuscitam a sessão, mas uma
      // identidade diferente e não tombstonada continua sendo uma troca
      // legítima informada pela fonte de verdade do Auth.
      if (next && signedOutUserIds.current.has(next.user.id)) return;

      if (!next) traceAuth('APPLY_SESSION_NULL');
      setSession(next);

      const nextId = next?.user.id ?? null;
      // O espelho de arquivos é namespaced pela conta que ESTÁ olhando, não
      // pelo UID que aparece no caminho do Storage. Quem responde "quem está
      // olhando" é esta função, que é a única porta de escrita da sessão.
      setMirrorViewer(nextId);
      if (nextId === loadedFor.current) return; // mesma conta: token novo, nada a recarregar
      /*
       * Trocou a identidade — saída, expiração, sessão encerrada por fora ou
       * outra conta entrando. Os canais Realtime da anterior caem AGORA.
       *
       * A folga de `CHANNEL_LINGER_MS` existe para a navegação: ela cobre o
       * remonte do Strict Mode e o vaivém entre as telas da mesma viagem, onde
       * quem sai volta em seguida. Aqui não há volta — quem sai é a conta. Deixar
       * a assinatura de A viva por cinco segundos enquanto B entra colocaria dois
       * conjuntos de canais de identidades diferentes no mesmo cliente, e o
       * primeiro evento que chegasse invalidaria cache de B em nome de A.
       *
       * O fechamento é síncrono e acontece antes de `loadedFor` apontar para a
       * conta nova, portanto antes de qualquer limpeza de cache endereçada à
       * anterior: `clearPrivateState` roda depois desta função em todos os
       * caminhos de saída. As telas que ainda estiverem montadas só perdem os
       * avisos — a saída da lista de ouvintes, quando o React chegar ao cleanup,
       * encontra o assunto já removido e não faz nada.
       */
      closeSharedRealtimeChannels();
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
      // Durante uma saída explícita, nem mesmo o SIGNED_OUT antecipado da SDK
      // decide a UI: o adaptador primeiro precisa comprovar a remoção no disco.
      if (!acceptPassiveSessions.current) return;

      if (!next) {
        // SIGNED_OUT não carrega identidade. O dono atualmente aplicado é o
        // alvo: tombstoná-lo impede que um SIGNED_IN já enfileirado da mesma
        // conta o ressuscite, sem bloquear uma troca legítima para outra conta.
        const currentUserId = loadedFor.current;
        if (currentUserId) signedOutUserIds.current.add(currentUserId);
        const bornAt = generation.current + 1;
        generation.current = bornAt;
        /*
         * Saída passiva é saída.
         *
         * O token pode ter sido revogado por fora, expirado sem renovação ou
         * encerrado em outro aparelho — e antes disto o provider derrubava
         * apenas a sessão em memória. O cache persistido, a seleção de viagem,
         * o contexto de IA e as cópias locais de arquivo continuavam no disco
         * até a próxima saída explícita, que podia nunca acontecer.
         *
         * A limpeza é a mesma do botão "Sair", com a mesma proteção de conta:
         * tudo abaixo é endereçado por `currentUserId`, então uma promessa
         * lenta de A não alcança escrita nenhuma de B (§9 do handoff).
         */
        invalidateQueryHydrations();
        void applySession(null, bornAt);
        // Em recuperação a marca precisa cair junto: sem sessão não há senha a
        // trocar, e a marca sozinha prenderia a próxima entrada.
        if (recoveryActive.current) void leaveRecovery();
        clearPrivateState(currentUserId ?? undefined);
        return;
      }

      // SIGNED_IN/TOKEN_REFRESHED/INITIAL_SESSION atrasado não ganha o direito
      // de desfazer uma decisão explícita de sair. Todo evento aceito abre uma
      // geração nova, invalidando restaurações/leitura de perfil mais antigas.
      if (signedOutUserIds.current.has(next.user.id)) return;
      const bornAt = generation.current + 1;
      generation.current = bornAt;
      void applySession(next, bornAt);
    });

    (async () => {
      const bornAt = generation.current;
      try {
        /*
         * A marca de recuperação é lida ANTES da sessão, e o resultado é
         * aplicado antes de `initializing` cair.
         *
         * A sessão do link de recuperação é uma sessão de verdade: reabrir o
         * aplicativo no meio da troca de senha faz `restore()` devolvê-la, e
         * sem a marca o aplicativo abriria inteiro. Ler primeiro e marcar antes
         * de liberar o splash é o que impede a Home de aparecer por alguns
         * quadros (§7 do handoff, caso C).
         *
         * As duas leituras saem juntas: a marca está no armazenamento local e a
         * sessão também, e serializá-las só adiaria o fim do splash.
         */
        const [mark, restored] = await Promise.all([readRecoveryMark(), authAdapter.restore()]);
        if (!active) return;

        if (mark && restored) {
          recoveryActive.current = true;
          setRecoveryPending(true);
        } else if (mark) {
          // Marca sem sessão não tem o que recuperar — e deixá-la em disco
          // prenderia a próxima entrada numa tela de trocar senha sem sessão.
          await clearRecoveryMark();
        }

        if (restored) await applySession(restored, bornAt);
        else setMirrorViewer(null);
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
  }, [applySession, clearPrivateState, leaveRecovery]);

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
        enterRecovery();
        return;
      }

      const grant = toRecoveryGrant(link);
      if (!grant) return;

      /*
       * A marca entra ANTES do resgate, não depois.
       *
       * `exchangeCodeForSession`/`setSession` fazem o supabase-js anunciar a
       * sessão pelo `onAuthStateChange` — e esse anúncio pode chegar antes de a
       * chamada retornar. Marcando primeiro, o evento antecipado ainda é uma
       * sessão de recuperação: `isAuthenticated` continua falso e a árvore
       * privada não monta em nenhum quadro (§7 do handoff, caso B).
       */
      setRecoveryError(null);
      enterRecovery();

      try {
        const next = await authAdapter.redeemRecovery(grant);
        if (!active) return;
        acceptPassiveSessions.current = true;
        signedOutUserIds.current.delete(next.user.id);
        generation.current += 1;
        // Agora sim há identidade: a marca em disco passa a dizer de quem é.
        enterRecovery(next.user.id);
        await applySession(next);
      } catch (error) {
        if (!active) return;
        setRecoveryError(
          error instanceof Error ? error.message : 'Não foi possível validar este link.',
        );
        // Continua em recuperação: um link recusado não abre o aplicativo, e a
        // tela oferece "Cancelar", que é a única saída.
        enterRecovery();
      }
    };

    void getInitialUrl().then(handle);
    const unsubscribe = subscribeToUrls((url) => void handle(url));

    return () => {
      active = false;
      unsubscribe();
    };
  }, [applySession, enterRecovery]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const next = await authAdapter.signIn(email, password);
      // Entrada explícita: a trava contra ressurreição existe para eventos de
      // fundo, não para uma pessoa decidindo entrar de novo.
      acceptPassiveSessions.current = true;
      signedOutUserIds.current.delete(next.user.id);
      generation.current += 1;
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

      acceptPassiveSessions.current = true;
      signedOutUserIds.current.delete(outcome.session.user.id);
      generation.current += 1;
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

  /**
   * Sair da conta.
   *
   * A ordem é a regra inteira, e ela mudou depois do teste em aparelho:
   *
   * 1. **Encerrar a sessão do aparelho.** O adaptador só volta sem exceção
   *    quando o token realmente não está mais no disco — com rede, sem rede ou
   *    com o servidor pendurado (ver `SupabaseAuthAdapter.signOut`). Se ele
   *    lançar, nada é limpo e o aplicativo continua exatamente onde estava:
   *    meia-saída seria pior que a falha.
   *
   * 2. **Derrubar a sessão em memória, aqui, na mesma ação.** Não se espera o
   *    aviso do provedor. O aviso continua existindo e continua sendo
   *    bem-vindo (é ele que cobre o token revogado por fora), mas o botão
   *    "Sair" não pode depender dele — era essa dependência que deixava a
   *    interface logada esperando uma resposta de rede.
   *
   * 3. **Limpar o resto sem segurar a interface.** Cache, arquivos locais e
   *    preferências saem depois, e de propósito **fora** do caminho crítico:
   *    a árvore privada já desmontou no passo 2. O trabalho é disparado e
   *    observado por tracing, mas não faz parte da promessa que libera a
   *    navegação.
   */
  const signOut = useCallback((): Promise<void> => {
    // Dois toques compartilham a mesma operação. A segunda chamada não resolve
    // cedo nem dispara outro `auth.signOut()`.
    if (signingOut.current) return signingOut.current;

    traceAuth('SIGNOUT_BEGIN');
    const dono = session?.user.id;
    const bornAt = generation.current + 1;
    generation.current = bornAt;
    acceptPassiveSessions.current = false;
    if (dono) signedOutUserIds.current.add(dono);

    const operation = (async () => {
      try {
        await authAdapter.signOut();
      } catch (error) {
        // A sessão local não foi comprovadamente removida. O estado visível
        // fica de pé e eventos normais voltam a ser aceitos para uma tentativa
        // futura não deixar o provider congelado.
        acceptPassiveSessions.current = true;
        if (dono) signedOutUserIds.current.delete(dono);
        throw error;
      }

      // A partir daqui a saída aconteceu. Nada abaixo pode falhar de um jeito
      // que devolva a pessoa para dentro da conta.
      // Fecha sincronicamente qualquer leitura de cache iniciada por esta
      // sessão antes de o React chegar ao cleanup do `QueryPersistence`.
      invalidateQueryHydrations();
      // Zerar o perfil é o que zera o papel: como `role` é derivada e não um
      // estado separado, não existe cópia da permissão anterior para esquecer
      // de limpar. A próxima conta começa sem privilégio (§26).
      await applySession(null, bornAt);
      await leaveRecovery();

      // `clearPrivateState` esvazia o QueryClient de forma síncrona no começo,
      // mas arquivos/preferências podem levar muito tempo. Nenhum deles segura
      // o login nem o reset de navegação.
      void clearPrivateState(dono);
      // Só reabre eventos depois do clear síncrono do QueryClient. Assim uma
      // troca passiva para B não consegue gravar memória na janela entre a
      // queda de A e a limpeza que pertence a A.
      acceptPassiveSessions.current = true;
    })();

    signingOut.current = operation;
    void operation.then(
      () => {
        if (signingOut.current === operation) signingOut.current = null;
      },
      () => {
        if (signingOut.current === operation) signingOut.current = null;
      },
    );
    return operation;
  }, [session, applySession, clearPrivateState, leaveRecovery]);

  const requestPasswordReset = useCallback(async (email: string) => {
    await authAdapter.requestPasswordReset(email, createRedirectUrl(RECOVERY_PATH));
  }, []);

  const completePasswordReset = useCallback(
    async (password: string) => {
      // A senha nova é a prova de posse que faltava. Só depois de o provedor
      // confirmar a troca é que a marca sai do disco e a sessão deixa de ser
      // "de recuperação": se `updatePassword` lançar, continua tudo como estava
      // e a tela mostra o erro, sem abrir o aplicativo.
      await authAdapter.updatePassword(password);
      await leaveRecovery();
    },
    [leaveRecovery],
  );

  const cancelPasswordReset = useCallback(async () => {
    /*
     * Desistir da troca de senha é encerrar a sessão do link.
     *
     * A sessão de recuperação é uma sessão de verdade: sair do formulário sem
     * revogá-la deixaria o aparelho autenticado com ela. E aqui não vale
     * "tentou, seguiu em frente": se a remoção local NÃO for comprovada, o
     * token continua no disco, e limpar a interface como se tivesse saído
     * mostraria a tela de login com uma sessão viva por baixo — a próxima
     * abertura reabriria a recuperação, ou pior, o aplicativo.
     *
     * Então a falha sobe para a tela. O que se mantém é o estado honesto:
     * ainda em recuperação, ainda com sessão, com um erro que a pessoa pode
     * tentar de novo (§7 do handoff, caso F).
     */
    const dono = session?.user.id;
    await authAdapter.signOut();

    acceptPassiveSessions.current = false;
    if (dono) signedOutUserIds.current.add(dono);
    generation.current += 1;
    invalidateQueryHydrations();
    await applySession(null);
    await leaveRecovery();
    acceptPassiveSessions.current = true;
    clearPrivateState(dono);
  }, [session, applySession, clearPrivateState, leaveRecovery]);

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

    acceptPassiveSessions.current = false;
    signedOutUserIds.current.add(session.user.id);
    generation.current += 1;
    invalidateQueryHydrations();
    await applySession(null);
    await leaveRecovery();
    acceptPassiveSessions.current = true;
    clearPrivateState(session.user.id);
  }, [session, applySession, clearPrivateState, leaveRecovery]);

  const refreshProfile = useCallback(async () => {
    if (session) await loadProfile(session.user.id);
  }, [session, loadProfile]);

  // Uma sessão de recuperação autentica para trocar a senha, e só. Deixá-la
  // valer como sessão comum transformaria "recebi um e-mail" em uma forma
  // alternativa de entrar sem saber a senha.
  const isAuthenticated = Boolean(session) && !recoveryPending;

  useEffect(() => {
    traceAuth(`AUTH_IS_AUTHENTICATED:${isAuthenticated}`);
  }, [isAuthenticated]);

  const value = useMemo<AuthValue>(
    () => ({
      user: session?.user ?? null,
      session,
      profile,
      initializing,
      isAuthenticated,
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
      isAuthenticated,
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
