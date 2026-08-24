import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { parseAIActions, type AITripAction } from '@/domain/aiActions';
/*
 * Anti-spam do lado do cliente (§10).
 *
 * O mesmo teto da Edge Function — 5 por 60s —, aplicado **antes** de a
 * requisição sair. Não substitui o servidor: um cliente modificado ignora isto
 * numa linha, e é por isso que o limite de lá continua existindo. O que este
 * daqui resolve é o caso comum e o mais caro: toque duplo, insistência num
 * botão que parece travado, sequência de perguntas em três segundos. Cada uma
 * dessas seria uma chamada paga ao Gemini e uma resposta que ninguém leu.
 *
 * A janela é deslizante e guarda só os instantes das mensagens **enviadas** —
 * tentativa recusada não entra, ou insistir esticaria a própria espera.
 */
import { AI_RATE_LIMIT, AIRateLimitError } from '@/domain/aiRateLimit';
import {
  getDaysUntilTrip,
  getRemainingBudget,
  getTripStatus,
  getTripTotalSpent,
} from '@/domain/selectors';
import type { Trip } from '@/domain/types';
import { useAuth } from '@/providers/AuthProvider';
import { dataSource } from '@/repositories';
import { aiService, buildTripContext } from '@/services/ai';
import { queryKeys } from './queryKeys';
import { useChecklist, useExpenses, useItinerary } from './useTripData';
import { useTripMembers } from './useCollaboration';
import { usePlaces } from './useContent';

/**
 * A conversa da Easy Trip IA para a viagem escolhida (§47).
 *
 * O assistente recebe os registros *reais* daquela viagem — orçamento,
 * despesas, roteiro, checklist — para responder sobre ela e não sobre um
 * destino genérico.
 *
 * CONTEXTO É A VIAGEM RECEBIDA, PONTO
 *
 * O hook não busca viagem nenhuma: quem manda é o `trip` que a tela passa, e a
 * tela só passa objetos vindos da lista do próprio usuário (`useTrips`, que é
 * `list(userId)` sob RLS). Nunca existe um `tripId` solto virando contexto, e
 * como toda consulta de dados é chaveada por `trip.id`, não há como misturar
 * duas viagens: trocar a viagem troca a conversa, o contexto e o histórico de
 * uma vez só.
 *
 * Sem viagem selecionada não há conversa e `send` recusa — é isso que garante
 * que nenhuma pergunta saia sem contexto.
 */
export function useAIConversation(trip: Trip | null) {
  const { user, session, profile } = useAuth();
  const queryClient = useQueryClient();

  /**
   * Conversa aberta explicitamente por "Novo chat".
   *
   * Existe porque `getOrCreateConversation` é uma consulta em cache: a conversa
   * recém-criada precisa valer no mesmo instante, sem depender do refetch.
   */
  const [openedConversationId, setOpenedConversationId] = useState<string | null>(null);

  /**
   * As propostas desta sessão, por mensagem do assistente.
   *
   * Vivem em memória, e não no banco, porque `ai_messages` tem exatamente três
   * colunas de conteúdo — `role`, `content`, `created_at` — e nenhuma para
   * metadado estruturado. Persistir action exigiria uma migration nova, e a §15
   * pede o contrário: primeiro tentar sem. Uma proposta é uma oferta viva de
   * uma conversa em andamento; reabrir um chat de três semanas atrás e
   * encontrar um botão "Implementar roteiro" apontando para datas que já
   * passaram seria pior do que não encontrar botão nenhum.
   *
   * Consequência assumida: reabrir o app deixa o histórico intacto e sem
   * botões. O texto da resposta continua lá; basta pedir de novo para receber
   * uma proposta nova, feita com os dados de hoje.
   */
  const [actionsByMessage, setActionsByMessage] = useState<Record<string, AITripAction[]>>({});

  /**
   * Propostas já aplicadas nesta sessão.
   *
   * É a trava contra o toque duplo e contra o "implementar" acidental duas
   * vezes na mesma proposta (§10): o botão vira "Adicionado à viagem" e não
   * volta atrás sozinho.
   */
  const [appliedActionIds, setAppliedActionIds] = useState<string[]>([]);

  /**
   * Instantes das mensagens efetivamente enviadas nesta sessão.
   *
   * `useRef` e não `useState` de propósito: a decisão "cabe mais uma?" precisa
   * ser tomada com o valor **do momento do toque**, e não com o que o React
   * renderizou por último. Dois toques no mesmo frame leem o mesmo estado — e
   * era assim que o toque duplo virava duas chamadas ao Gemini.
   */
  const sentAt = useRef<number[]>([]);
  /** Uma pergunta em voo por vez, mesmo antes de o React repintar. */
  const inFlight = useRef(false);

  const recentSends = useCallback((now: number) => {
    sentAt.current = sentAt.current.filter((t) => now - t < AI_RATE_LIMIT.windowMs);
    return sentAt.current;
  }, []);

  /** Segundos até caber outra mensagem. Zero quando já cabe. */
  const retryAfterSeconds = useCallback(
    (now: number = Date.now()) => {
      const recent = recentSends(now);
      if (recent.length < AI_RATE_LIMIT.max) return 0;
      return Math.max(1, Math.ceil((AI_RATE_LIMIT.windowMs - (now - Math.min(...recent))) / 1000));
    },
    [recentSends],
  );

  // Trocar de viagem é trocar de conversa: a escolha manual não pode sobreviver
  // à troca, ou o chat de Tóquio continuaria escrevendo na thread de Paris.
  // As propostas vão junto — uma sugestão de roteiro para Paris não pode
  // sobreviver à troca para Tóquio nem como botão na tela (§14).
  useEffect(() => {
    setOpenedConversationId(null);
    setActionsByMessage({});
    setAppliedActionIds([]);
  }, [trip?.id]);

  const conversationQuery = useQuery({
    queryKey: queryKeys.aiConversation(user?.id ?? 'anonymous', trip?.id),
    queryFn: () => dataSource.ai.getOrCreateConversation(user!.id, trip!.id),
    enabled: Boolean(user && trip),
  });

  const conversationId = openedConversationId ?? conversationQuery.data?.id;

  const messagesQuery = useQuery({
    queryKey: queryKeys.aiMessages(conversationId ?? 'none'),
    queryFn: () => dataSource.ai.listMessages(conversationId!),
    enabled: Boolean(conversationId),
  });

  // Dados da viagem que alimentam o contexto do modelo.
  const { data: expenses = [] } = useExpenses(trip?.id);
  const { data: itinerary = [] } = useItinerary(trip?.id);
  const { data: checklist = [] } = useChecklist(trip?.id);
  const { data: places = [] } = usePlaces(trip ? { city: trip.destinationCity } : undefined);
  // Quantos viajantes — para o modelo escrever "o roteiro de vocês" quando for
  // o caso, e não tratar uma viagem de três pessoas como se fosse de uma (§57).
  const { data: members = [] } = useTripMembers(trip?.id);

  const send = useMutation({
    mutationFn: async (prompt: string) => {
      if (!trip) throw new Error('Selecione uma viagem antes de perguntar.');
      if (!conversationId) throw new Error('Conversa indisponível.');

      /*
       * A recusa acontece **antes** de qualquer efeito.
       *
       * Nada foi gravado, nada foi invalidado, e o texto digitado continua com
       * quem digitou — a tela não o apaga quando o envio é recusado. Uma recusa
       * que já tivesse escrito a mensagem do usuário no banco deixaria a
       * conversa com uma pergunta sem resposta e sem explicação.
       */
      const now = Date.now();
      if (inFlight.current) throw new AIRateLimitError(0);
      if (recentSends(now).length >= AI_RATE_LIMIT.max) {
        throw new AIRateLimitError(retryAfterSeconds(now));
      }
      inFlight.current = true;
      sentAt.current = [...sentAt.current, now];
      try {
        const history = messagesQuery.data ?? [];
        await dataSource.ai.addMessage({ conversationId, role: 'user', content: prompt });
        await queryClient.invalidateQueries({ queryKey: queryKeys.aiMessages(conversationId) });

        const context = buildTripContext({
          trip,
          status: getTripStatus(trip),
          daysUntil: getDaysUntilTrip(trip),
          totalSpent: getTripTotalSpent(expenses, trip),
          remainingBudget: getRemainingBudget(expenses, trip),
          expenses,
          itinerary,
          checklist,
          profile,
          places,
          // §15: quem está perguntando. Sem isto, `buildTripContext` descarta
          // até o conteúdo privado do próprio usuário — o lado seguro do erro.
          viewerId: user?.id,
          memberCount: members.length || undefined,
        });

        const reply = await aiService.send({
          prompt,
          context,
          history,
          accessToken: session?.accessToken,
        });

        const message = await dataSource.ai.addMessage({
          conversationId,
          role: 'assistant',
          content: reply.content,
        });

        /*
         * É aqui que a proposta ganha dono.
         *
         * `reply.actions` é o que chegou pela rede — cru, sem viagem, sem
         * garantia nenhuma. `parseAIActions` valida contra o schema do domínio e
         * carimba `tripId` com a viagem **desta** conversa, que é o `trip` que
         * esta mutation capturou. O modelo nunca teve chance de escolher a
         * viagem: ele não a viu e não tem campo para ela.
         */
        const actions = parseAIActions(reply.actions, trip);
        if (actions.length > 0) {
          setActionsByMessage((current) => ({ ...current, [message.id]: actions }));
        }

        return { ...reply, messageId: message.id, actions };
      } finally {
        inFlight.current = false;
      }
    },
    onSettled: () => {
      if (conversationId) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.aiMessages(conversationId) });
      }
    },
  });

  /**
   * "Novo chat": a conversa anterior **deixa de existir**.
   *
   * Mudança de produto, e ela inverte o que este botão fazia. Antes ele abria
   * outra thread e deixava a anterior guardada; o produto decidiu não ter
   * histórico de conversas com a IA. Guardar chats que nenhuma tela abre é o
   * pior dos dois mundos: o usuário acha que apagou, e o dado continua lá.
   *
   * A ordem é apagar e só então criar. Criar primeiro deixaria, numa falha no
   * meio, duas conversas para a mesma viagem — e a tela reabriria na antiga,
   * que era exatamente a que o usuário mandou apagar.
   *
   * A viagem selecionada não muda: começar de novo é sobre a conversa, não
   * sobre o contexto.
   */
  const newChat = useMutation({
    mutationFn: async () => {
      if (!trip) throw new Error('Selecione uma viagem antes de iniciar um chat.');
      if (conversationId) await dataSource.ai.deleteConversation(conversationId);
      return dataSource.ai.createConversation(user!.id, trip.id);
    },
    onSuccess: (conversation) => {
      // A conversa nasce vazia; semear o cache evita o piscar do histórico
      // antigo enquanto a lista de mensagens ainda não voltou.
      queryClient.setQueryData(queryKeys.aiMessages(conversation.id), []);
      setOpenedConversationId(conversation.id);
      // As propostas pendentes vão junto: elas pertenciam a mensagens que
      // acabaram de ser apagadas, e um botão "Implementar" apontando para uma
      // conversa que não existe mais é uma promessa sem lastro.
      setActionsByMessage({});
      setAppliedActionIds([]);
      send.reset();
      void queryClient.invalidateQueries({
        queryKey: queryKeys.aiConversation(user!.id, trip!.id),
      });
    },
  });

  const actionsFor = useCallback(
    (messageId: string): AITripAction[] => actionsByMessage[messageId] ?? [],
    [actionsByMessage],
  );

  const markApplied = useCallback((actionIds: string[]) => {
    setAppliedActionIds((current) => [...new Set([...current, ...actionIds])]);
  }, []);

  const unmarkApplied = useCallback((actionIds: string[]) => {
    const removed = new Set(actionIds);
    setAppliedActionIds((current) => current.filter((id) => !removed.has(id)));
  }, []);

  /** Propostas explicitamente descartadas pelo usuário nesta sessão. */
  const [dismissedMessageIds, setDismissedMessageIds] = useState<string[]>([]);

  useEffect(() => {
    setDismissedMessageIds([]);
  }, [trip?.id]);

  /**
   * A proposta aberta — a mais recente ainda não aplicada nem descartada.
   *
   * Ordenada pela lista de mensagens, e não pela ordem de chegada das
   * respostas: é a ordem que o usuário vê na tela, e "a proposta" para quem
   * está conversando é a última que apareceu.
   */
  const pendingProposal = useMemo(() => {
    const messages = messagesQuery.data ?? [];
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const messageId = messages[index].id;
      if (dismissedMessageIds.includes(messageId)) continue;
      const actions = actionsByMessage[messageId] ?? [];
      if (actions.length === 0) continue;
      if (actions.every((action) => appliedActionIds.includes(action.id))) continue;
      return { messageId, actions };
    }
    return null;
  }, [messagesQuery.data, actionsByMessage, appliedActionIds, dismissedMessageIds]);

  const dismissProposal = useCallback((messageId: string) => {
    setDismissedMessageIds((current) => [...new Set([...current, messageId])]);
  }, []);

  return {
    conversationId,
    messages: messagesQuery.data ?? [],
    /** Propostas desta sessão para uma mensagem — vazio para conversas antigas. */
    actionsFor,
    appliedActionIds,
    markApplied,
    /** Usado pelo "Desfazer": o que foi removido volta a poder ser aplicado. */
    unmarkApplied,
    isLoading: Boolean(trip) && (conversationQuery.isLoading || messagesQuery.isLoading),
    send,
    newChat,
    /**
     * A proposta ainda **aberta**: a mais recente que chegou nesta sessão e
     * que ninguém aplicou nem descartou.
     *
     * Existe para o caso que o teste em aparelho expôs: a pessoa responde
     * "pode aplicar" à proposta que está na tela. Sem isto, a frase virava
     * outra pergunta ao Gemini — que respondia "revise e confirme no
     * aplicativo" sobre uma proposta que ele não tem como reabrir. Com isto, a
     * tela abre a revisão da proposta que já está ali.
     */
    pendingProposal,
    /** Descarta a proposta aberta sem aplicá-la. */
    dismissProposal,
    /** Segundos até caber outra mensagem; zero quando já cabe. */
    retryAfterSeconds,
    /** `gemini` when the BFF is wired up, `local` otherwise — shown as a badge. */
    kind: aiService.kind,
  };
}

export { AI_RATE_LIMIT, AIRateLimitError };
