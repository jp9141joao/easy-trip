import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';

import {
  enforceAIActionPromiseCoherence,
  hasRenderableText,
  parseAIActions,
  type AITripAction,
} from '@/domain/aiActions';
import { allowsAIMutation } from '@/domain/aiIntent';
import { AIRequestError, aiTrace } from '@/lib/aiTrace';
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
import {
  AI_RATE_LIMIT,
  AIRateLimitError,
  AIRequestInFlightError,
} from '@/domain/aiRateLimit';
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
 * Janela do cliente por conta, compartilhada entre montagens da aba.
 *
 * Guardar isto dentro do hook permitia zerar o limite trocando rapidamente
 * para "Especialistas" e voltando para "IA de Viagens", porque a aba é
 * desmontada nessa troca. O Map vive só na memória deste processo (não
 * persiste identificador nem mensagem) e mantém a janela móvel durante toda a
 * sessão do aplicativo. O servidor continua sendo a barreira independente.
 */
const clientRateLimitHits = new Map<string, number[]>();
const clientRequestsInFlight = new Set<string>();

function recentClientSends(key: string, now: number): number[] {
  const recent = (clientRateLimitHits.get(key) ?? []).filter(
    (stamp) => now - stamp < AI_RATE_LIMIT.windowMs,
  );
  if (recent.length > 0) clientRateLimitHits.set(key, recent);
  else clientRateLimitHits.delete(key);
  return recent;
}

/** Somente testes: cada cenário começa com uma sessão de aplicativo nova. */
export function resetAIClientRateLimitForTests(): void {
  clientRateLimitHits.clear();
  clientRequestsInFlight.clear();
}

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
/**
 * A proposta aberta de uma conversa: percorre as mensagens da mais recente para
 * a mais antiga e devolve a primeira com propostas ainda não aplicadas nem
 * descartadas. Função pura, fora do hook, para que a memoização em
 * `useAIConversation` seja só a de entrada e saída.
 */
function findPendingProposal(
  messages: readonly { id: string }[],
  actionsByMessage: Record<string, AITripAction[]>,
  appliedActionIds: readonly string[],
  dismissedMessageIds: readonly string[],
): { messageId: string; actions: AITripAction[] } | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const messageId = messages[index].id;
    if (dismissedMessageIds.includes(messageId)) continue;
    const actions = actionsByMessage[messageId] ?? [];
    if (actions.length === 0) continue;
    if (actions.every((action) => appliedActionIds.includes(action.id))) continue;
    return { messageId, actions };
  }
  return null;
}

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

  /** Propostas explicitamente descartadas pelo usuário nesta sessão. */
  const [dismissedMessageIds, setDismissedMessageIds] = useState<string[]>([]);

  // Trocar de viagem é trocar de conversa: a escolha manual não pode sobreviver
  // à troca, ou o chat de Tóquio continuaria escrevendo na thread de Paris.
  // As propostas vão junto — uma sugestão de roteiro para Paris não pode
  // sobreviver à troca para Tóquio nem como botão na tela (§14).
  //
  // O ajuste acontece no próprio render em que a troca é percebida (o padrão do
  // React para estado que depende de uma entrada), e não num efeito: assim nem
  // um commit mostra a proposta de Paris com a viagem já em Tóquio.
  const [sessionTripId, setSessionTripId] = useState(trip?.id);
  if (sessionTripId !== trip?.id) {
    setSessionTripId(trip?.id);
    setOpenedConversationId(null);
    setActionsByMessage({});
    setAppliedActionIds([]);
    setDismissedMessageIds([]);
  }

  const rateLimitKey = user?.id ?? 'anonymous';

  const recentSends = useCallback((now: number) => {
    return recentClientSends(rateLimitKey, now);
  }, [rateLimitKey]);

  /** Segundos até caber outra mensagem. Zero quando já cabe. */
  const retryAfterSeconds = useCallback(
    (now: number = Date.now()) => {
      const recent = recentSends(now);
      if (recent.length < AI_RATE_LIMIT.max) return 0;
      return Math.max(1, Math.ceil((AI_RATE_LIMIT.windowMs - (now - Math.min(...recent))) / 1000));
    },
    [recentSends],
  );

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
      if (clientRequestsInFlight.has(rateLimitKey)) throw new AIRequestInFlightError();
      const recent = recentSends(now);
      if (recent.length >= AI_RATE_LIMIT.max) {
        throw new AIRateLimitError(retryAfterSeconds(now));
      }
      clientRequestsInFlight.add(rateLimitKey);
      clientRateLimitHits.set(rateLimitKey, [...recent, now]);
      try {
        aiTrace('USER_SEND', { size: prompt.length });
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

        /*
         * É aqui que a proposta ganha dono **antes** de o texto ser salvo.
         *
         * `reply.actions` é o que chegou pela rede — cru, sem viagem, sem
         * garantia nenhuma. `parseAIActions` valida contra o schema do domínio e
         * carimba `tripId` com a viagem **desta** conversa, que é o `trip` que
         * esta mutation capturou. O modelo nunca teve chance de escolher a
         * viagem: ele não a viu e não tem campo para ela.
         *
         * A coerência usa o número **depois** dessa validação. Usar o array cru
         * permitiria que uma action inválida mantivesse no histórico frases como
         * "revise e confirme" embora nenhum card pudesse ser renderizado. Isso
         * também protege o app enquanto a Function remota estiver numa versão
         * anterior à correção equivalente do servidor.
         */
        aiTrace('AI_PARSE_BEGIN', { size: reply.content.length });
        /*
         * `context.trip.today` é o hoje do DESTINO, e não o do aparelho.
         *
         * Só `journal.add` o usa, para separar plano de relato: quem está em
         * São Paulo às 22h do dia 17 planejando o dia 18 em Tóquio já está no
         * dia 18 lá. Usar a data local marcaria como "planejado" um dia que,
         * no lugar sobre o qual a pessoa escreve, já começou.
         */
        const validated = parseAIActions(reply.actions, trip, context.trip.today);

        /*
         * A ÚLTIMA BARREIRA CONTRA UMA PROPOSTA QUE NINGUÉM PEDIU.
         *
         * O servidor já descarta actions quando o pedido é de leitura
         * (`gateActionsByIntent`). Esta camada existe porque a Edge Function
         * publicada pode estar numa versão anterior a essa correção — e nesse
         * intervalo "liste meu roteiro do dia 18" ainda voltaria com um dia
         * montado e o cartão de revisão. Uma consulta nunca pode abrir uma
         * gravação, nem contra um servidor desatualizado.
         *
         * `allowsAIMutation` é conservador de propósito: só barra o que é
         * leitura COMPROVADA. Um "pode ser" respondendo a "posso montar o
         * roteiro?" não tem verbo nenhum e chega aqui como ambíguo — quem sabe
         * que aquilo é um aceite é o servidor, que tem o histórico. Barrar na
         * dúvida aqui apagaria a proposta certa logo depois de um "sim".
         */
        const mutationAllowed = allowsAIMutation(prompt);
        const actions = mutationAllowed ? validated : [];
        if (!mutationAllowed && validated.length > 0) {
          aiTrace('AI_ACTION_COUNT', {
            actionCount: 0,
            code: 'READ_ONLY_INTENT',
          });
        }

        const coherent = enforceAIActionPromiseCoherence(reply.content, actions.length);

        aiTrace('AI_PARSE_RESULT', {
          parsed: true,
          size: coherent.content.length,
          code: coherent.stripped > 0 ? 'PROMISES_STRIPPED' : undefined,
        });
        aiTrace('AI_ACTION_COUNT', {
          actionCount: actions.length,
          itineraryItems: actions.reduce(
            (total, action) => total + (action.type === 'itinerary.add' ? action.items.length : 0),
            0,
          ),
        });

        /*
         * A BOLHA DO "•" MORRE AQUI (§4 do handoff).
         *
         * Uma resposta cujo texto não tem letra nem dígito — um marcador de
         * lista solto, um traço, um bullet — não é resposta: renderiza uma
         * bolha muda e fica no histórico para sempre, reaparecendo a cada
         * abertura da conversa. Gravar isso é pior do que falhar, porque a
         * falha some quando a pessoa tenta de novo e a bolha não.
         *
         * As duas camadas de coerência já não produzem esse resíduo; esta é a
         * última barreira, e vale também para o que chegar pela rede de uma
         * versão anterior da Function.
         */
        if (!hasRenderableText(coherent.content)) {
          aiTrace('AI_REQUEST_ERROR', {
            httpStatus: 200,
            code: 'EMPTY_AFTER_PARSE',
            stage: 'PARSE',
            size: coherent.content.length,
          });
          throw new AIRequestError(
            { httpStatus: 200, code: 'EMPTY_AFTER_PARSE', stage: 'PARSE' },
            'O assistente respondeu sem nada legível. Tente novamente.',
          );
        }

        const message = await dataSource.ai.addMessage({
          conversationId,
          role: 'assistant',
          content: coherent.content,
        });
        aiTrace('AI_MESSAGE_COMMIT', { size: coherent.content.length });

        if (actions.length > 0) {
          setActionsByMessage((current) => ({ ...current, [message.id]: actions }));
          aiTrace('AI_ACTION_COMMIT', { actionCount: actions.length });
        }

        return { ...reply, content: coherent.content, messageId: message.id, actions };
      } finally {
        clientRequestsInFlight.delete(rateLimitKey);
        aiTrace('AI_REQUEST_END', {});
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

  /**
   * A proposta aberta — a mais recente ainda não aplicada nem descartada.
   *
   * Ordenada pela lista de mensagens, e não pela ordem de chegada das
   * respostas: é a ordem que o usuário vê na tela, e "a proposta" para quem
   * está conversando é a última que apareceu.
   */
  const messageList = messagesQuery.data;
  const pendingProposal = useMemo(
    () =>
      findPendingProposal(messageList ?? [], actionsByMessage, appliedActionIds, dismissedMessageIds),
    [messageList, actionsByMessage, appliedActionIds, dismissedMessageIds],
  );

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

export { AI_RATE_LIMIT, AIRateLimitError, AIRequestInFlightError };
