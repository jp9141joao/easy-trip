import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';

import { unreadCount } from '@/domain/notifications';
import type { AIConversation, JournalMedia, Reservation, Trip } from '@/domain/types';
import { clearAITripContextForTrip } from '@/lib/aiTripContext';
import { purgeTripMirrors } from '@/lib/fileMirror';
import { useAuth } from '@/providers/AuthProvider';
import { useTripSelection } from '@/providers/TripSelectionProvider';
import { dataSource } from '@/repositories';
import {
  isBackendAuthorizationError,
  isBackendCapabilityError,
  readBackendErrorCode,
} from '@/repositories/backendCapabilities';
import { queryKeys } from './queryKeys';

/**
 * A Central de notificações (§7).
 *
 * `useAlerts` continua existindo e não é substituído. As duas fontes respondem
 * perguntas diferentes: aquela diz o que está acontecendo com a viagem agora
 * (recalculado, sem estado de lido), esta diz o que aconteceu (evento, com
 * instante e lido/não lido). O badge conta só esta — se contasse a outra, um
 * orçamento em 85% ficaria eternamente marcado como não lido.
 */
export function useNotifications() {
  const { user } = useAuth();

  return useQuery({
    queryKey: queryKeys.notifications(user?.id ?? 'anonymous'),
    queryFn: () => dataSource.notifications.list(user!.id),
    enabled: Boolean(user?.id),
  });
}

export function useUnreadNotificationCount(): number {
  const { data = [] } = useNotifications();
  return useMemo(() => unreadCount(data), [data]);
}

export function useNotificationMutations() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const key = queryKeys.notifications(user?.id ?? 'anonymous');
  const invalidate = () => queryClient.invalidateQueries({ queryKey: key });

  const markRead = useMutation({
    mutationFn: (id: string) => dataSource.notifications.markRead(id),
    // Tocar numa notificação tem de apagar o ponto na hora. A ida ao servidor
    // acontece atrás; se falhar, o rollback devolve o estado anterior.
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Awaited<ReturnType<typeof dataSource.notifications.list>>>(key);
      queryClient.setQueryData(key, (items: typeof previous) =>
        (items ?? []).map((item) =>
          item.id === id && !item.readAt ? { ...item, readAt: new Date().toISOString() } : item,
        ),
      );
      return { previous };
    },
    onError: (_error, _id, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: invalidate,
  });

  const markAllRead = useMutation({
    mutationFn: () => dataSource.notifications.markAllRead(user!.id),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => dataSource.notifications.remove(id),
    onSuccess: invalidate,
  });

  return { markRead, markAllRead, remove };
}

/**
 * POR QUE ESTA ENTREGA FALHA — e por que nem toda falha dela é um defeito.
 *
 * O sintoma no Android era `REMINDER_DELIVERY_FAILED {"kind":"Error"}`, uma
 * linha que não conseguia nomear a própria causa: o erro do PostgREST chega
 * como objeto simples, `throwBackendError` o trocava por um `new Error(...)`
 * genérico, e o que sobrava para logar era o `name` desse Error. O diagnóstico
 * foi restaurado em `backendCapabilities.ts`; aqui ele é usado.
 *
 * A entrega de lembretes é um esforço de melhor tentativa na abertura do
 * aplicativo. Duas categorias de falha são ESPERADAS e não são defeito:
 *
 *   CAPACIDADE AUSENTE   a 0010 ainda não foi publicada neste servidor. Os
 *                        lembretes simplesmente não são entregues, e a Central
 *                        já explica isso na tela.
 *
 *   AUTORIZAÇÃO/SESSÃO   a chamada saiu sem JWT válido (token ainda não
 *                        anexado na abertura, expirado, ou revogado). O
 *                        Postgres responde 42501 — é a própria trava da função
 *                        funcionando, não um erro de programação.
 *
 * Nenhuma das duas merece `console.warn`: em DEV isso abre o LogBox amarelo em
 * cima do aplicativo a cada abertura, e um alarme que toca sempre deixa de ser
 * alarme. Elas saem por `console.log`, no mesmo padrão de diagnóstico
 * estruturado de `aiTrace` — visível para quem procura, silencioso para quem
 * não está.
 *
 * Qualquer outra falha CONTINUA em `console.warn`. Nada é silenciado de forma
 * ampla, e `LogBox.ignoreLogs` não é usado em lugar nenhum: esconder a
 * categoria inteira apagaria justamente o caso que precisa ser visto.
 *
 * O que sai no log são só rótulos — categoria, código do PostgREST, nome da
 * classe. Nunca payload, identificador de usuário, token ou conteúdo.
 */
export function reportReminderDeliveryFailure(error: unknown): void {
  if (process.env.NODE_ENV === 'production') return;

  if (isBackendCapabilityError(error)) {
    console.log(
      'REMINDER_DELIVERY_SKIPPED',
      JSON.stringify({ reason: 'CAPABILITY_UNAVAILABLE', capability: error.code }),
    );
    return;
  }

  if (isBackendAuthorizationError(error)) {
    console.log(
      'REMINDER_DELIVERY_SKIPPED',
      JSON.stringify({ reason: 'NOT_AUTHORIZED', backendCode: readBackendErrorCode(error) }),
    );
    return;
  }

  console.warn(
    'REMINDER_DELIVERY_FAILED',
    JSON.stringify({
      kind: error instanceof Error ? error.name : 'unknown',
      backendCode: readBackendErrorCode(error) ?? null,
    }),
  );
}

/**
 * Entrega os lembretes vencidos quando o aplicativo abre.
 *
 * ISTO NÃO É PUSH, e não finge ser (§33). Sem notificação do sistema
 * operacional, o lembrete aparece no primeiro momento em que a pessoa abre o
 * Easy Trip depois do horário — nunca antes, nunca com o aplicativo fechado. O
 * que está escrito na tela de lembretes diz exatamente isso.
 *
 * Roda uma vez por sessão. O `ref` existe porque este hook vive no layout raiz,
 * que re-renderiza a cada navegação: sem ele, cada troca de tela dispararia uma
 * chamada — e a função no Postgres, apesar de idempotente, não precisa ser
 * chamada trinta vezes para não fazer nada.
 *
 * UMA TENTATIVA RECUSADA POR SESSÃO NÃO PODE VALER PELA VIAGEM INTEIRA.
 *
 * `deliver_due_reminders` roda como `security definer` e recusa com 42501
 * quando `auth.uid()` é nulo — é a trava da própria função, e ela dispara se a
 * chamada sair antes de o JWT estar anexado, ou com um token já expirado. Como
 * a marca de tentativa era gravada ANTES da chamada e o efeito só dependia do
 * `user.id`, um único instante ruim na abertura deixava os lembretes sem
 * entrega até o aplicativo ser reiniciado.
 *
 * A correção tem duas metades, e as duas são necessárias:
 *   - o efeito passou a observar também o token, que é o que muda quando a
 *     sessão fica utilizável (`INITIAL_SESSION`, `TOKEN_REFRESHED`);
 *   - uma recusa de autorização LIMPA a marca, para que a próxima sessão
 *     válida possa tentar de novo.
 *
 * Isto não vira laço: um sucesso mantém a marca, e a RPC é idempotente pelo
 * `sent_at` — uma segunda passagem no mesmo dia entrega zero e não duplica
 * notificação nenhuma.
 */
export function useReminderDelivery() {
  const { user, session } = useAuth();
  const queryClient = useQueryClient();
  // Isto registra uma tentativa, não uma entrega. A entrega só é confirmada
  // pelo número devolvido pela RPC; uma rejeição nunca vira `0` nem sucesso.
  const attemptedFor = useRef<string | null>(null);
  const accessToken = session?.accessToken;

  useEffect(() => {
    const userId = user?.id;
    if (!userId || attemptedFor.current === userId) return;
    attemptedFor.current = userId;

    let cancelled = false;
    void dataSource.notifications
      .deliverDueReminders(userId)
      .then((count) => {
        if (cancelled || count === 0) return;
        return queryClient.invalidateQueries({ queryKey: queryKeys.notifications(userId) });
      })
      // Falhar aqui não pode impedir o aplicativo de abrir. Também não pode
      // fingir `0` entregas: a rejeição continua rejeição, e o que ela vira em
      // DEV é decidido por `reportReminderDeliveryFailure`.
      .catch((error: unknown) => {
        // Recusa de autorização é a única que libera nova tentativa: ela
        // costuma significar "ainda não" e não "nunca". Capacidade ausente e
        // defeito real não melhoram com repetição, e repetir os dois só
        // gastaria rede a cada renovação de token.
        if (isBackendAuthorizationError(error) && attemptedFor.current === userId) {
          attemptedFor.current = null;
        }
        reportReminderDeliveryFailure(error);
      });

    return () => {
      cancelled = true;
    };
  }, [user?.id, accessToken, queryClient]);
}

/**
 * Limpa o que sobrou de uma viagem à qual a pessoa perdeu acesso (§59).
 *
 * O cache persistido é escopado por conta (`queryPersistence`), o que resolve
 * "USER_A não reidrata dados de USER_B". O que ele não resolve sozinho é a
 * mudança de MEMBERSHIP dentro da mesma conta: quem foi removido de Paris
 * continuaria com o roteiro e as reservas de Paris em disco, e a Home os
 * mostraria por um instante na próxima abertura, antes de o refetch corrigir.
 *
 * "Por um instante" é tempo suficiente para alguém ler o que não deveria mais
 * ver. Então a notificação `trip_member_removed` — que é do próprio usuário e
 * chega pela Central — dispara a remoção de todas as chaves daquela viagem, do
 * cache em memória e do que for gravado depois.
 *
 * Não apaga a notificação: ela é o registro de que o acesso acabou, e a pessoa
 * tem o direito de lê-la.
 */
/**
 * Quanto tempo a auditoria de acesso pode demorar antes de ser considerada
 * inconclusiva (§17 do handoff).
 *
 * `trips.list()` é uma chamada de rede, e uma rede ruim pode deixá-la pendurada
 * indefinidamente. Enquanto ela não volta, o roteiro e as reservas de uma
 * viagem possivelmente revogada continuam em disco. Oito segundos é mais do que
 * uma listagem precisa em qualquer conexão utilizável, e é curto o bastante
 * para "não consegui provar acesso" virar decisão em vez de espera eterna.
 */
export const REVOKED_TRIP_AUDIT_TIMEOUT_MS = 8_000;

/** Marca de prazo estourado, distinguível de uma lista legitimamente vazia. */
const AUDIT_TIMED_OUT = Symbol('audit-timed-out');

async function auditWithDeadline(
  audit: Promise<Trip[]>,
  ms: number,
): Promise<Trip[] | typeof AUDIT_TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      audit,
      new Promise<typeof AUDIT_TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(AUDIT_TIMED_OUT), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function useRevokedTripCleanup() {
  const { data: notifications = [] } = useNotifications();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { currentTripId, setCurrentTripId } = useTripSelection();

  /**
   * A seleção atual, lida no momento em que a auditoria termina.
   *
   * Não entra nas dependências do efeito: se entrasse, trocar de viagem no meio
   * de uma verificação reiniciaria a verificação. E a decisão de limpar a
   * seleção precisa olhar o valor de AGORA, não o de quando o efeito montou.
   *
   * É atualizada num efeito sem dependências, e não durante o render: o render
   * precisa ser puro, e a auditoria só termina de forma assíncrona, bem depois
   * do commit — quando o efeito já gravou o valor confirmado.
   */
  const selection = useRef({ currentTripId, setCurrentTripId });
  useEffect(() => {
    selection.current = { currentTripId, setCurrentTripId };
  });

  /**
   * Viagens cuja verificação já foi disparada nesta sessão.
   *
   * Vive fora do efeito porque a limpeza NÃO pode ser cancelada pelo que a
   * disparou. Apagar (ou marcar como lida) a notificação `trip_member_removed`
   * enquanto a verificação corre muda `revokedTripIds`, o efeito reexecuta e o
   * `cleanup` do anterior rodaria — abortando a limpeza de segurança no meio.
   * Registrando aqui, cada candidato é verificado uma vez até o fim,
   * independentemente do que aconteça com a notificação (§18 do handoff).
   */
  const audited = useRef(new Set<string>());

  /**
   * O registro é por conta. A raiz do aplicativo não desmonta na troca de
   * usuário, e sem isto uma viagem já auditada para A seria pulada para B — que
   * pode ter sido removido da mesma viagem, por outro motivo, depois.
   *
   * A troca é detectada no início do efeito abaixo, que já depende de
   * `user?.id` — e antes do retorno antecipado, para que `A → sem sessão → A`
   * também comece do zero.
   */
  const auditedFor = useRef<string | null>(null);

  const revokedTripIds = useMemo(
    () =>
      notifications
        .filter((notification) => notification.type === 'trip_member_removed')
        .map((notification) => notification.data.tripId)
        .filter((tripId): tripId is string => Boolean(tripId))
        .join(','),
    [notifications],
  );

  useEffect(() => {
    const userId = user?.id;
    if (auditedFor.current !== (userId ?? null)) {
      auditedFor.current = userId ?? null;
      audited.current = new Set<string>();
    }
    if (!userId || !revokedTripIds) return;

    const candidates = [...new Set(revokedTripIds.split(','))].filter(
      (tripId) => !audited.current.has(tripId),
    );
    if (candidates.length === 0) return;
    for (const tripId of candidates) audited.current.add(tripId);

    const purge = (tripIds: readonly string[]) =>
      purgeRevokedTripState(queryClient, userId, tripIds, {
        currentTripId: selection.current.currentTripId,
        clear: () => selection.current.setCurrentTripId(null),
      });

    void (async () => {
      let accessibleTrips: Trip[] | typeof AUDIT_TIMED_OUT;
      try {
        /*
         * Uma notificação é histórica; acesso não é. Consultar o backend aqui
         * impede que uma remoção antiga apague novamente Paris depois de a
         * mesma pessoa ter sido convidada de volta. A chamada é direta ao
         * repositório, portanto não pode devolver a lista reidratada do cache.
         */
        accessibleTrips = await auditWithDeadline(
          dataSource.trips.list(userId),
          REVOKED_TRIP_AUDIT_TIMEOUT_MS,
        );
      } catch (error: unknown) {
        // Sem conseguir provar acesso atual, privacidade vence disponibilidade:
        // removemos os candidatos em vez de conservar dados possivelmente
        // revogados. O próximo refetch bem-sucedido da Home repõe uma eventual
        // reconvocação; nenhum erro bruto ou identificador vai para o log.
        purge(candidates);
        if (process.env.NODE_ENV !== 'production') {
          console.warn('REVOKED_TRIP_ACCESS_AUDIT_FAILED', {
            kind: error instanceof Error ? error.name : 'unknown',
          });
        }
        return;
      }

      if (accessibleTrips === AUDIT_TIMED_OUT) {
        // Mesma regra da falha: uma auditoria que não volta não é prova de
        // acesso, e dado privado não fica pendurado esperando por ela.
        purge(candidates);
        if (process.env.NODE_ENV !== 'production') {
          console.warn('REVOKED_TRIP_ACCESS_AUDIT_FAILED', { kind: 'timeout' });
        }
        return;
      }

      /*
       * A leitura acabada de fazer é também a fonte canônica da Home. Assim a
       * viagem realmente revogada some do agregado; a reconvidada continua —
       * acesso atual tem precedência sobre o evento histórico (§19 do handoff).
       */
      queryClient.setQueryData(queryKeys.trips(userId), accessibleTrips);
      purge(revokedTripsWithoutCurrentAccess(candidates, accessibleTrips));
    })();
  }, [queryClient, revokedTripIds, user?.id]);
}

/**
 * Uma remoção antiga deixa de ser revogação assim que o backend volta a listar
 * a viagem. Exportada para que a reconvocação tenha uma regressão unitária sem
 * montar a árvore inteira de providers.
 */
export function revokedTripsWithoutCurrentAccess(
  candidates: readonly string[],
  accessibleTrips: readonly Pick<Trip, 'id'>[],
): string[] {
  const accessibleIds = new Set(accessibleTrips.map((trip) => trip.id));
  return [...new Set(candidates)].filter((tripId) => !accessibleIds.has(tripId));
}

/**
 * Os caminhos de Storage que esta viagem tem espelhados no aparelho.
 *
 * A varredura por pasta em `purgeTripMirrors` cobre anexo e documento de
 * reserva, cuja chave é `{uid}/{tripId}/{arquivo}`. A mídia do diário usa
 * `{uid}/{entryId}/{arquivo}` — a viagem não aparece no caminho — então os
 * caminhos dela saem do cache, que é lido ANTES de as chaves serem removidas.
 */
function mirrorPathsForTrip(
  queryClient: QueryClient,
  tripId: string,
): { bucket: string; storagePath: string }[] {
  const paths: { bucket: string; storagePath: string }[] = [];

  const media = queryClient.getQueryData<JournalMedia[]>(queryKeys.journalMedia(tripId)) ?? [];
  for (const item of media) {
    if (item.filePath) paths.push({ bucket: 'journal', storagePath: item.filePath });
  }

  const reservations =
    queryClient.getQueryData<Reservation[]>(queryKeys.tripReservations(tripId)) ?? [];
  for (const item of reservations) {
    if (item.filePath) paths.push({ bucket: 'attachments', storagePath: item.filePath });
  }

  return paths;
}

/**
 * Remove todo estado conhecido de viagens cuja revogação foi confirmada.
 *
 * Inclui as cópias LOCAIS de arquivo daquela viagem (§14 do handoff). O
 * conteúdo remoto continua com o grupo: quem perdeu acesso perde a cópia dele,
 * e só a dele — o espelho é namespaced pela conta que baixou.
 */
export function purgeRevokedTripState(
  queryClient: QueryClient,
  userId: string,
  tripIds: readonly string[],
  selection?: { currentTripId: string | null; clear: () => void },
): void {
  const revoked = new Set(tripIds);
  if (revoked.size === 0) return;

  // A Home usa a coleção agregada, não `queryKeys.trip(id)`. Sem filtrá-la, o
  // card revogado continuaria visível mesmo após todos os detalhes sumirem.
  queryClient.setQueryData<Trip[] | undefined>(queryKeys.trips(userId), (trips) =>
    trips?.filter((trip) => !revoked.has(trip.id)),
  );
  if (selection?.currentTripId && revoked.has(selection.currentTripId)) selection.clear();

  for (const tripId of revoked) {
    const conversationKey = queryKeys.aiConversation(userId, tripId);
    const conversation = queryClient.getQueryData<AIConversation>(conversationKey);
    // Antes de `removeQueries`: depois dele o cache já não sabe quais arquivos
    // esta viagem tinha, e o espelho ficaria no disco sem nada que o cite.
    const mirrors = mirrorPathsForTrip(queryClient, tripId);
    purgeTripMirrors(userId, tripId, mirrors);
    // A seleção da IA é persistida à parte da seleção da Home e sobreviveria à
    // remoção das chaves de cache, reabrindo a conversa numa viagem recusada.
    void clearAITripContextForTrip(userId, tripId);

    // `removeQueries` e não `invalidateQueries`: invalidar pediria os dados de
    // novo, o servidor recusaria, e a tela poderia conservar o cache antigo.
    for (const key of [
      queryKeys.trip(tripId),
      queryKeys.itinerary(tripId),
      queryKeys.checklist(tripId),
      queryKeys.expenses(tripId),
      queryKeys.journal(tripId),
      queryKeys.journalMedia(tripId),
      queryKeys.tripReservations(tripId),
      queryKeys.suggestions(tripId),
      queryKeys.tripMembers(tripId),
      queryKeys.tripMemberNames(tripId),
      queryKeys.tripInvites(tripId),
      queryKeys.myRole(tripId, userId),
      queryKeys.reminders(tripId, userId),
      conversationKey,
    ]) {
      queryClient.removeQueries({ queryKey: key });
    }
    if (conversation?.id) {
      queryClient.removeQueries({ queryKey: queryKeys.aiMessages(conversation.id) });
    }
  }
}
