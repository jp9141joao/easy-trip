import { zodResolver } from '@hookform/resolvers/zod';
import { Bot, CalendarCheck, Info, Sparkles, UserRoundCheck } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AIActionCard,
  AIActionResult,
  AIActionReviewSheet,
  AIComposer,
  TripContextBar,
  TripPickerSheet,
} from '@/components/ai';
import { AdvisorCard } from '@/components/cards';
import { Markdown } from '@/components/Markdown';
import {
  AppText,
  Badge,
  BottomSheet,
  Button,
  Chip,
  ChipRow,
  ConfirmDialog,
  EmptyState,
  GlassCard,
  InlineNotice,
  PageLabel,
  SectionHeader,
  SegmentedTabs,
  SkeletonList,
  TextField,
  useToast,
} from '@/components/ui';
import { AuroraBackground } from '@/components/ui/Surface';
import { DOCK_CLEARANCE } from '@/constants/layout';
import { useKeyboardVisible } from '@/hooks/useKeyboard';
import { buildReviewGroups, reviewToActions } from '@/domain/aiActionReview';
import type { AITripAction } from '@/domain/aiActions';
import { consultationSchema, type ConsultationInput } from '@/domain/schemas';
import type { Advisor } from '@/domain/types';
import { useAIConversation } from '@/hooks/useAI';
import { AIActionBlockedError, useAIActionRunner } from '@/hooks/useAIActions';
import { useAdvisors, useConsultations } from '@/hooks/useContent';
import { useChecklist, useItinerary } from '@/hooks/useTripData';
import { useTrips } from '@/hooks/useTrips';
import type { AIActionReport } from '@/services/aiActionExecutor';
import { useTripSelection } from '@/providers/TripSelectionProvider';
import { CONSULTATION_STATUS_HINT, CONSULTATION_STATUS_LABEL } from '@/lib/labels';
import { markdownToPlainText } from '@/lib/markdown';
import { AI_SUGGESTIONS } from '@/services/ai';
import { useTheme } from '@/theme';

type Tab = 'experts' | 'ai';

export default function AdvisorScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('experts');

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AuroraBackground />

      <View
        style={{
          paddingTop: insets.top + theme.spacing.sm,
          paddingHorizontal: theme.spacing.screen,
          gap: theme.spacing.lg,
        }}
      >
        <View>
          <PageLabel>Assessoria</PageLabel>
          <AppText variant="h1">Precisa de ajuda?</AppText>
        </View>

        <SegmentedTabs<Tab>
          items={[
            { value: 'experts', label: 'Especialistas' },
            { value: 'ai', label: 'IA de Viagens' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </View>

      {tab === 'experts' ? <ExpertsTab /> : <AITab />}
    </View>
  );
}

/* -------------------------------- experts --------------------------------- */

function ExpertsTab() {
  const theme = useTheme();
  const toast = useToast();
  const { data: advisors = [], isLoading } = useAdvisors();
  const { consultations, request } = useConsultations();
  const [selected, setSelected] = useState<Advisor | null>(null);

  const { control, handleSubmit, reset, formState } = useForm<ConsultationInput>({
    resolver: zodResolver(consultationSchema),
    values: { advisorId: selected?.id ?? '', scheduledAt: '', notes: '' },
  });

  const onSubmit = async (values: ConsultationInput) => {
    try {
      await request.mutateAsync({
        advisorId: values.advisorId,
        scheduledAt: values.scheduledAt,
        notes: values.notes,
      });
      // Deliberately not "Agendamento confirmado" — no advisor accepted yet (§46).
      toast.success('Solicitação enviada. Aguardando confirmação do especialista.');
      reset();
      setSelected(null);
    } catch {
      toast.error('Não foi possível enviar a solicitação. Tente novamente.');
    }
  };

  return (
    // Mesmo defeito do composer, na aba vizinha: o formulário de solicitação
    // tem campos de texto, e sem isto o último deles fica atrás do teclado.
    // Não muda nada com o teclado fechado.
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.screen,
          paddingTop: theme.spacing.xl,
          paddingBottom: DOCK_CLEARANCE + theme.spacing['3xl'],
        }}
      >
        {consultations.length > 0 ? (
          <View style={{ marginBottom: theme.spacing.xl }}>
            <SectionHeader title="Suas solicitações" />
            <View style={{ gap: theme.spacing.md }}>
              {consultations.map((consultation) => {
                const advisor = advisors.find((item) => item.id === consultation.advisorId);
                return (
                  <GlassCard key={consultation.id}>
                    <View
                      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}
                    >
                      <View
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: 20,
                          backgroundColor: theme.colors.primarySoft,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <CalendarCheck size={18} color={theme.colors.primary} />
                      </View>

                      <View style={{ flex: 1, gap: 2 }}>
                        <AppText variant="body" weight="semibold" numberOfLines={1}>
                          {advisor?.name ?? 'Especialista'}
                        </AppText>
                        <AppText variant="caption" color="secondary">
                          {CONSULTATION_STATUS_HINT[consultation.status]}
                        </AppText>
                      </View>

                      <Badge
                        label={CONSULTATION_STATUS_LABEL[consultation.status]}
                        tone={
                          consultation.status === 'scheduled'
                            ? 'success'
                            : consultation.status === 'cancelled'
                              ? 'neutral'
                              : 'warning'
                        }
                      />
                    </View>
                  </GlassCard>
                );
              })}
            </View>
          </View>
        ) : null}

        <SectionHeader
          title="Especialistas"
          subtitle="Converse com quem já planejou centenas de roteiros"
        />

        {isLoading ? (
          <SkeletonList count={3} lines={2} />
        ) : advisors.length === 0 ? (
          <GlassCard>
            <EmptyState
              icon={UserRoundCheck}
              title="Nenhum especialista disponível"
              message="Tente novamente mais tarde."
              compact
            />
          </GlassCard>
        ) : (
          advisors.map((advisor) => (
            <AdvisorCard key={advisor.id} advisor={advisor} onPress={() => setSelected(advisor)} />
          ))
        )}

        <BottomSheet
          visible={Boolean(selected)}
          onClose={() => setSelected(null)}
          title={selected ? `Consultoria com ${selected.name}` : undefined}
          subtitle={selected?.specialty}
        >
          {selected ? (
            <View style={{ gap: theme.spacing.lg }}>
              {selected.bio ? (
                <AppText variant="bodySmall" color="secondary">
                  {selected.bio}
                </AppText>
              ) : null}

              <InlineNotice icon={Info}>
                Sua solicitação fica registrada como pendente até que o especialista confirme a data.
              </InlineNotice>

              <Controller
                control={control}
                name="scheduledAt"
                render={({ field, fieldState }) => (
                  <TextField
                    label="Quando você gostaria de conversar?"
                    placeholder="Ex.: quinta à tarde, ou 20/09 às 15h"
                    value={field.value}
                    onChangeText={field.onChange}
                    error={fieldState.error?.message}
                    required
                  />
                )}
              />

              <Controller
                control={control}
                name="notes"
                render={({ field, fieldState }) => (
                  <TextField
                    label="O que você precisa?"
                    placeholder="Conte o destino, as datas e suas dúvidas principais"
                    value={field.value}
                    onChangeText={field.onChange}
                    error={fieldState.error?.message}
                    multiline
                  />
                )}
              />

              <Button
                label="Enviar solicitação"
                fullWidth
                size="lg"
                loading={formState.isSubmitting || request.isPending}
                onPress={handleSubmit(onSubmit)}
                haptic
              />
            </View>
          ) : null}
        </BottomSheet>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/* ----------------------------------- AI ----------------------------------- */

function AITab() {
  const theme = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();

  /*
   * Contexto da IA é estado desta tela, não o estado global do app (§1).
   *
   * `currentTripId` continua sendo "a viagem que o app está mostrando" e é
   * usado aqui apenas como pré-seleção de conveniência — e só se aquele id
   * estiver mesmo na lista do usuário. Escolher outra viagem para a IA não
   * mexe na viagem ativa do restante do app: são duas perguntas diferentes
   * ("o que estou vendo?" e "sobre o que estou perguntando?"), e amarrar as
   * duas foi justamente o que deixou o contexto implícito.
   */
  const { data: trips = [], isLoading: tripsLoading } = useTrips();
  const { currentTripId } = useTripSelection();
  const [aiTripId, setAiTripId] = useState<string | null>(null);
  const [chosen, setChosen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmNewChat, setConfirmNewChat] = useState(false);

  useEffect(() => {
    if (chosen) return;
    if (currentTripId && trips.some((item) => item.id === currentTripId)) setAiTripId(currentTripId);
  }, [chosen, currentTripId, trips]);

  // Viagem excluída não pode continuar sendo o contexto: a referência órfã sai
  // e a tela volta ao estado "selecione uma viagem".
  useEffect(() => {
    if (aiTripId && !trips.some((item) => item.id === aiTripId)) setAiTripId(null);
  }, [aiTripId, trips]);

  const trip = trips.find((item) => item.id === aiTripId) ?? null;

  const {
    messages,
    send,
    newChat,
    kind,
    isLoading,
    actionsFor,
    appliedActionIds,
    markApplied,
    unmarkApplied,
  } = useAIConversation(trip);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  /*
   * Roteiro e checklist da viagem, aqui, por um motivo só: detectar duplicata
   * antes de gravar (§22). O React Query já tem estas duas consultas em cache —
   * a conversa da IA as usa para montar o contexto —, então isto não é uma
   * busca a mais, é a mesma.
   */
  const { data: itinerary = [] } = useItinerary(trip?.id);
  const { data: checklist = [] } = useChecklist(trip?.id);

  const runner = useAIActionRunner(trip);

  /** A proposta aberta na revisão, se houver. */
  const [review, setReview] = useState<{ messageId: string; actions: AITripAction[] } | null>(null);
  /** O resultado da última execução, preso à mensagem que o gerou. */
  const [result, setResult] = useState<{ messageId: string; report: AIActionReport } | null>(null);

  // Trocar a viagem invalida qualquer proposta aberta: a revisão na tela é de
  // Paris, e a viagem agora é outra.
  useEffect(() => {
    setReview(null);
    setResult(null);
  }, [trip?.id]);

  /**
   * Aplica uma proposta já resolvida.
   *
   * O `try/catch` distingue os dois tipos de recusa: `AIActionBlockedError` é
   * uma condição que o usuário pode resolver (sem rede, outra aplicação em
   * curso) e a proposta continua na tela; qualquer outro erro é falha de
   * gravação, e aí o relatório do executor já descreve o que entrou e o que
   * não entrou.
   */
  const applyActions = async (messageId: string, actions: AITripAction[]) => {
    if (actions.length === 0) return;
    try {
      const report = await runner.run(messageId, actions);
      setReview(null);
      setResult({ messageId, report });

      /*
       * A proposta é consumida assim que **qualquer coisa** entrou.
       *
       * A tentação é deixar o botão vivo numa execução parcial, para a pessoa
       * tentar de novo. Só que "de novo" reexecutaria também o que já gravou, e
       * o resultado seria uma duplicata silenciosa — o oposto do que a §22
       * tenta evitar. Repetir só é seguro quando nada entrou; então é só nesse
       * caso que o botão continua disponível.
       */
      if (report.outcomes.some((outcome) => outcome.succeeded > 0)) {
        markApplied(actions.map((action) => action.id));
      }

      if (report.ok) {
        toast.success(report.outcomes.map((outcome) => outcome.summary).join(' · '));
      } else if (report.partial) {
        toast.warning('Parte da sugestão não pôde ser adicionada. Veja os detalhes.');
      } else {
        toast.error('Não foi possível adicionar a sugestão.');
      }
    } catch (error) {
      if (error instanceof AIActionBlockedError) {
        toast.warning(error.message);
        return;
      }
      toast.error('Não foi possível adicionar a sugestão. Tente novamente.');
    }
  };

  /**
   * "Implementar" abre a revisão ou aplica direto?
   *
   * Abre quando há mais de um bloco (um plano composto — §9 pede confirmação
   * explícita para escolher o que entra) ou quando algum item veio marcado como
   * possível duplicata ou fora do período da viagem. Nos dois casos existe uma
   * decisão real a tomar, e tomá-la por conta própria seria gravar em silêncio.
   *
   * Aplica direto quando a proposta é um bloco só, limpo: o caso do "monte meu
   * roteiro de amanhã" que volta com quatro itens dentro das datas certas. Aí a
   * revisão seria uma confirmação sem conteúdo — e "Revisar" continua ao lado
   * para quem quiser ajustar antes.
   */
  const implement = (messageId: string, actions: AITripAction[]) => {
    if (!trip) return;
    const groups = buildReviewGroups(actions, { trip, itinerary, checklist });
    const needsDecision =
      actions.length > 1 || groups.some((group) => group.items.some((item) => item.warnings.length > 0));

    if (needsDecision) {
      setReview({ messageId, actions });
      return;
    }
    void applyActions(messageId, reviewToActions(groups));
  };

  const undoResult = async () => {
    if (!result) return;
    const { removed, failed } = await runner.undo(result.report);
    unmarkApplied(actionsFor(result.messageId).map((action) => action.id));
    setResult(null);
    if (failed > 0) {
      toast.warning(`${removed} ${removed === 1 ? 'registro removido' : 'registros removidos'}, ${failed} não.`);
    } else {
      toast.success(`${removed} ${removed === 1 ? 'registro removido' : 'registros removidos'}.`);
    }
  };

  // Abrir o teclado também reposiciona a conversa: quem começa a digitar quer
  // ver a última mensagem, não o topo do histórico (§12). O atraso curto deixa
  // o layout assentar antes de medir, e o timer é cancelado a cada mudança —
  // não há como acumular scrolls.
  useEffect(() => {
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120);
    return () => clearTimeout(timer);
  }, [messages.length, send.isPending, keyboardVisible]);

  const submit = async (text: string) => {
    const prompt = text.trim();
    // Sem viagem escolhida a pergunta não sai — não existe contexto para ela.
    if (!prompt || !trip || send.isPending) return;
    setDraft('');
    try {
      await send.mutateAsync(prompt);
    } catch {
      toast.error('Não foi possível obter uma resposta agora. Tente novamente.');
    }
  };

  const selectTrip = (tripId: string) => {
    setChosen(true);
    setAiTripId(tripId);
    setPickerOpen(false);
    // A conversa que aparece a seguir é a daquela viagem: contexto, histórico e
    // thread trocam juntos, então a próxima pergunta já sai com os dados novos
    // e nada de Paris atravessa para Tóquio.
    setDraft('');
    send.reset();
  };

  const startNewChat = async () => {
    setConfirmNewChat(false);
    try {
      await newChat.mutateAsync();
      setDraft('');
      toast.success('Novo chat iniciado. A conversa anterior continua salva.');
    } catch {
      toast.error('Não foi possível iniciar um novo chat agora. Tente novamente.');
    }
  };

  const requestNewChat = () => {
    if (!trip) return;
    if (messages.length === 0) {
      void startNewChat();
      return;
    }
    setConfirmNewChat(true);
  };

  return (
    /*
     * `behavior` precisa existir nas duas plataformas (§5).
     *
     * Antes era `undefined` no Android, o que faz o componente não fazer nada.
     * Isso funcionava quando o Android encolhia a janela com `adjustResize`,
     * mas o app roda com `edgeToEdgeEnabled`: a janela não encolhe mais, o IME
     * chega como inset, e por isso nada acima do teclado se mexia — o composer
     * simplesmente ficava atrás dele.
     *
     * `padding` é seguro nos dois casos porque o próprio RN mede a
     * *sobreposição real* entre o rodapé desta view e o topo do teclado
     * (`max(frame.y + frame.height - keyboardY, 0)`). Se a janela tiver
     * encolhido, a sobreposição é zero e nada é somado; se não tiver, soma
     * exatamente o quanto falta. Nenhum valor fixo, nenhuma altura de teclado
     * codificada.
     */
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior="padding"
      keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
    >
      {/*
        Contexto e "Novo chat" ficam fixos acima da conversa: são os dois
        controles que o usuário precisa achar sem rolar (§1, §2). Fixos, não
        sobrepostos — a barra está fora do ScrollView, então nenhuma mensagem
        passa por baixo dela.

        Antes eram três blocos empilhados (card de contexto + linha do "Novo
        chat" + respiros), perto de 150pt de cabeçalho. Agora é uma linha de
        `hitTarget`, e a diferença toda virou área de conversa.
      */}
      <View
        style={{
          paddingHorizontal: theme.spacing.screen,
          paddingTop: theme.spacing.sm,
        }}
      >
        <TripContextBar
          trip={trip}
          onChangeTrip={() => setPickerOpen(true)}
          onNewChat={requestNewChat}
          disabled={tripsLoading}
          newChatDisabled={!trip || newChat.isPending}
        />
      </View>

      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        // Com o teclado aberto, um toque em algo interativo deve acionar o
        // elemento, não ser consumido só para fechar o teclado (§14).
        keyboardShouldPersistTaps="handled"
        // Arrastar a conversa fecha o teclado, que é o gesto que o usuário já
        // espera — sem precisar de um botão só para isso (§15).
        keyboardDismissMode="on-drag"
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.screen,
          paddingTop: theme.spacing.md,
          paddingBottom: theme.spacing.lg,
          gap: theme.spacing.md,
        }}
      >
        {/* Honest about which engine is answering (§1, §118). */}
        {kind === 'local' ? (
          <InlineNotice icon={Info} tone="warning">
            Modo demonstração: as respostas são geradas localmente a partir dos dados reais da sua
            viagem. Configure o BFF (EXPO_PUBLIC_BFF_URL) para conversar com o Gemini.
          </InlineNotice>
        ) : null}

        {!trip ? (
          <GlassCard>
            <EmptyState
              icon={Sparkles}
              title={trips.length === 0 ? 'Crie uma viagem primeiro' : 'Escolha uma viagem'}
              message={
                trips.length === 0
                  ? 'O assistente responde a partir dos dados de uma viagem sua. Crie uma viagem para começar.'
                  : 'Selecione uma viagem para que a IA use roteiro, gastos, checklist e orçamento como contexto.'
              }
              compact
            />
          </GlassCard>
        ) : isLoading ? (
          <SkeletonList count={2} lines={2} />
        ) : messages.length === 0 ? (
          <GlassCard>
            <View style={{ gap: theme.spacing.md, alignItems: 'center' }}>
              <View
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 28,
                  backgroundColor: theme.colors.primarySoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Bot size={26} color={theme.colors.primary} />
              </View>
              <AppText variant="h3" align="center">
                Easy Trip IA
              </AppText>
              <AppText variant="bodySmall" color="secondary" align="center">
                Perguntas sobre {trip.destinationCity}: orçamento, roteiro ou o que ainda falta
                organizar.
              </AppText>
            </View>
          </GlassCard>
        ) : (
          messages.map((message) => {
            const actions = actionsFor(message.id);
            const applied =
              actions.length > 0 && actions.every((action) => appliedActionIds.includes(action.id));

            return (
              <View key={message.id} style={{ gap: theme.spacing.sm }}>
                <MessageBubble message={message} />

                {/*
                  O card só existe quando a resposta trouxe proposta. Pergunta
                  de leitura — "quanto já gastei?" — não ganha botão nenhum
                  (§17).
                */}
                {actions.length > 0 ? (
                  <AIActionCard
                    actions={actions}
                    applied={applied}
                    pending={runner.runningKey === message.id}
                    onReview={() => setReview({ messageId: message.id, actions })}
                    onImplement={() => implement(message.id, actions)}
                  />
                ) : null}

                {result?.messageId === message.id ? (
                  <AIActionResult
                    report={result.report}
                    undoing={runner.undoing}
                    onUndo={result.report.undoable ? () => void undoResult() : undefined}
                    onDismiss={() => setResult(null)}
                  />
                ) : null}
              </View>
            );
          })
        )}

        {send.isPending ? <TypingIndicator /> : null}
      </ScrollView>

      {/* Quick suggestions (§50) — só fazem sentido com contexto escolhido. */}
      {trip ? (
        <View style={{ paddingLeft: theme.spacing.screen, paddingBottom: theme.spacing.sm }}>
          <ChipRow>
            {AI_SUGGESTIONS.map((suggestion) => (
              <Chip key={suggestion} label={suggestion} onPress={() => void submit(suggestion)} />
            ))}
          </ChipRow>
        </View>
      ) : null}

      {/*
        O espaço reservado embaixo existe para o dock flutuante, não para o
        teclado. Com o teclado aberto o dock sai de cena, então manter os 110pt
        deixaria o composer boiando bem acima do teclado. Aqui ele cai para a
        área segura do aparelho — continua sendo um valor do sistema, não um
        número mágico atrelado a tamanho de teclado (§3, §6).
      */}
      <AIComposer
        value={draft}
        onChangeText={setDraft}
        onSubmit={(text) => void submit(text)}
        disabled={!trip}
        pending={send.isPending}
        disabledHint="Selecione uma viagem para conversar com a IA"
        paddingBottom={
          keyboardVisible
            ? Math.max(insets.bottom, theme.spacing.sm)
            : DOCK_CLEARANCE - theme.spacing.md
        }
      />

      {trip && review ? (
        <AIActionReviewSheet
          visible
          actions={review.actions}
          trip={trip}
          itinerary={itinerary}
          checklist={checklist}
          pending={runner.runningKey === review.messageId}
          onCancel={() => setReview(null)}
          onConfirm={(actions) => void applyActions(review.messageId, actions)}
        />
      ) : null}

      <TripPickerSheet
        visible={pickerOpen}
        trips={trips}
        selectedTripId={aiTripId}
        onSelect={selectTrip}
        onClose={() => setPickerOpen(false)}
      />

      <ConfirmDialog
        visible={confirmNewChat}
        title="Iniciar novo chat?"
        message="A conversa atual será encerrada nesta tela. Ela continua salva no seu histórico."
        confirmLabel="Novo chat"
        cancelLabel="Cancelar"
        loading={newChat.isPending}
        onConfirm={() => void startNewChat()}
        onCancel={() => setConfirmNewChat(false)}
      />
    </KeyboardAvoidingView>
  );
}

function MessageBubble({
  message,
}: {
  message: { role: string; content: string; createdAt: string };
}) {
  const theme = useTheme();
  const isUser = message.role === 'user';

  return (
    <View
      style={{
        alignSelf: isUser ? 'flex-end' : 'flex-start',
        // A bolha da IA é mais larga que a do usuário de propósito: ela carrega
        // listas e títulos, e a do usuário carrega uma frase.
        maxWidth: isUser ? '88%' : '96%',
        // A bolha da IA tem papel próprio: no claro ela precisava se separar do
        // fundo, e no escuro os tokens repetem `surface`/`border` (§4).
        backgroundColor: isUser ? theme.colors.primary : theme.colors.bubbleAssistant,
        borderRadius: theme.radius.card,
        borderTopRightRadius: isUser ? 6 : theme.radius.card,
        borderTopLeftRadius: isUser ? theme.radius.card : 6,
        borderWidth: isUser ? 0 : 1,
        borderColor: theme.colors.bubbleAssistantBorder,
        // Resposta longa com títulos e listas precisa de respiro: apertado, a
        // hierarquia do Markdown some (§4).
        paddingVertical: theme.spacing.lg,
        paddingHorizontal: isUser ? theme.spacing.lg : theme.spacing.xl,
      }}
      accessible
      // O leitor de tela ouve a frase, não a pontuação do Markdown.
      accessibilityLabel={`${isUser ? 'Você' : 'Easy Trip IA'}: ${
        isUser ? message.content : markdownToPlainText(message.content)
      }`}
    >
      {isUser ? (
        <AppText variant="body" color="onPrimary">
          {message.content}
        </AppText>
      ) : (
        <Markdown content={message.content} variant="bodySmall" />
      )}
    </View>
  );
}

function TypingIndicator() {
  const theme = useTheme();
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        backgroundColor: theme.colors.bubbleAssistant,
        borderRadius: theme.radius.card,
        borderWidth: 1,
        borderColor: theme.colors.bubbleAssistantBorder,
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
      }}
    >
      <Bot size={16} color={theme.colors.primary} />
      <AppText variant="caption" color="secondary">
        Analisando sua viagem…
      </AppText>
    </View>
  );
}
