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
  type ActionVisibility,
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
import { DockAwareColumn, useDockMetrics } from '@/components/navigation/DockMetrics';
import { DOCK_CLEARANCE } from '@/constants/layout';
import { useKeyboardVisible } from '@/hooks/useKeyboard';
import { buildReviewGroups, reviewToActions } from '@/domain/aiActionReview';
import { isApplyConfirmation, type AITripAction } from '@/domain/aiActions';
import { consultationSchema, type ConsultationInput } from '@/domain/schemas';
import type { Advisor } from '@/domain/types';
import {
  AIRateLimitError,
  AIRequestInFlightError,
  useAIConversation,
} from '@/hooks/useAI';
import { useAITripContext } from '@/hooks/useAITripContext';
import { AIActionBlockedError, useAIActionRunner } from '@/hooks/useAIActions';
import { useAdvisors, useConsultations } from '@/hooks/useContent';
import { useChecklist, useItinerary } from '@/hooks/useTripData';
import { useTrips } from '@/hooks/useTrips';
import type { AIActionReport } from '@/services/aiActionExecutor';
import { useAuth } from '@/providers/AuthProvider';
import { CONSULTATION_STATUS_HINT, CONSULTATION_STATUS_LABEL } from '@/lib/labels';
import {
  AIRequestError,
  aiTrace,
  describeAIFailure,
  formatAIFailure,
  type AITraceFields,
} from '@/lib/aiTrace';
import { aiBackendState } from '@/lib/config';
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
  const keyboardVisible = useKeyboardVisible();
  const dock = useDockMetrics();

  /*
   * CONTEXTO DA IA É UMA SELEÇÃO PRÓPRIA — E SÓ DELA.
   *
   * A viagem que a Home abre (`currentTripId`) e a viagem que a IA lê são duas
   * perguntas diferentes: "o que estou vendo?" e "sobre o que estou
   * perguntando?". Enquanto a segunda usava a primeira como pré-seleção,
   * escolher Paris na Home trocava por baixo o contexto de uma conversa sobre
   * Tóquio — sem toque, sem aviso, e com a resposta seguinte saindo com os
   * dados da viagem errada.
   *
   * Por isso esta tela **não lê `currentTripId`**, nem como fallback. A
   * seleção anterior vem de `aiTripContextId:<userId>`, é validada contra a
   * lista real do usuário, e sem escolha anterior a tela pede uma escolha.
   */
  const { data: trips = [], isLoading: tripsLoading, isSuccess: tripsLoaded } = useTrips();
  const { user } = useAuth();
  const {
    tripId: aiTripId,
    select: selectAiTrip,
    restoring: contextRestoring,
  } = useAITripContext(user?.id ?? null, trips, tripsLoaded);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmNewChat, setConfirmNewChat] = useState(false);

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
    pendingProposal,
    dismissProposal,
  } = useAIConversation(trip);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  /*
   * O ÚLTIMO NÚMERO DO RASTRO — o que a tela desenhou.
   *
   * O rastro terminava em `AI_ACTION_COMMIT`, no estado. Entre o estado e o
   * pixel não havia medida, e foi exatamente esse trecho que precisou ser
   * investigado por leitura de código quando o Android mostrou "a proposta
   * está pronta" sem card nenhum.
   *
   * `messagesWithActions` e `renderedActionCards` saem juntos de propósito: um
   * número sozinho não diz nada, e o par responde a pergunta inteira. Se
   * divergirem, o defeito está aqui, na renderização — e não antes.
   *
   * São contagens. Nenhum texto de mensagem, nenhum id, nenhum dado da viagem.
   */
  const comAcoes = messages.reduce(
    (total, message) => total + (actionsFor(message.id).length > 0 ? 1 : 0),
    0,
  );
  useEffect(() => {
    aiTrace('AI_ACTION_RENDER', {
      messagesWithActions: comAcoes,
      renderedActionCards: comAcoes,
    });
  }, [comAcoes]);
  // O diagnóstico do último erro, mostrado só em DEV embaixo da conversa.
  const [lastFailure, setLastFailure] = useState<AITraceFields | null>(null);

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
  const applyActions = async (
    messageId: string,
    actions: AITripAction[],
    visibility?: ActionVisibility,
  ) => {
    if (actions.length === 0) return;
    try {
      const report = await runner.run(messageId, actions, visibility);
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
        /*
         * E a proposta deixa de estar aberta.
         *
         * `markApplied` cobre o caso em que tudo entrou; este cobre o outro —
         * a revisão em que a pessoa incluiu só parte dos blocos. O que não
         * entrou não é "ainda pendente": foi desmarcado de propósito. Sem
         * isto, um "pode aplicar" seguinte reabriria a revisão de uma proposta
         * que a pessoa já resolveu, com o relatório dela ainda na tela.
         */
        dismissProposal(messageId);
      }

      if (report.ok) {
        toast.success(report.outcomes.map((outcome) => outcome.summary).join(' · '));
      } else if (report.partial) {
        toast.warning('Parte da sugestão não pôde ser adicionada. Veja os detalhes.');
      } else {
        const backendFailure = report.outcomes
          .flatMap((outcome) => outcome.failed)
          .find((failure) => failure.backendCapability);
        toast.error(
          backendFailure?.reason ?? 'Não foi possível adicionar a sugestão.',
        );
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
    try {
      const { removed, failed } = await runner.undo(result.report);
      unmarkApplied(actionsFor(result.messageId).map((action) => action.id));
      setResult(null);
      if (failed > 0) {
        toast.warning(`${removed} ${removed === 1 ? 'registro removido' : 'registros removidos'}, ${failed} não.`);
      } else {
        toast.success(`${removed} ${removed === 1 ? 'registro removido' : 'registros removidos'}.`);
      }
    } catch (error) {
      if (error instanceof AIActionBlockedError) {
        toast.warning(error.message);
        return;
      }
      toast.error('Não foi possível desfazer a sugestão. Tente novamente.');
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

    /*
     * "Pode aplicar" com proposta aberta é confirmação, não pergunta.
     *
     * Mandar a frase ao Gemini custaria uma chamada para receber de volta
     * "revise e confirme no aplicativo" — sobre a proposta que já está na tela
     * e que o modelo não tem como reabrir. Foi exatamente o laço observado no
     * aparelho. Aqui a revisão abre com os itens à vista: reconhecer a
     * confirmação não é gravar sem mostrar.
     */
    if (pendingProposal && isApplyConfirmation(prompt)) {
      setDraft('');
      setReview({ messageId: pendingProposal.messageId, actions: pendingProposal.actions });
      return;
    }

    setDraft('');
    setLastFailure(null);
    try {
      await send.mutateAsync(prompt);
    } catch (error) {
      if (error instanceof AIRequestInFlightError) {
        // Metade duplicada de um toque duplo: a primeira chamada já levou o
        // mesmo texto. Restaurá-lo aqui faria parecer que ele não foi enviado
        // e convidaria a uma terceira tentativa.
        return;
      }
      if (error instanceof AIRateLimitError) {
        // O texto volta para o campo: a mensagem não saiu, e quem escreveu não
        // deve ter de digitar de novo por causa de um limite nosso.
        setDraft(prompt);
        toast.warning(error.message);
        return;
      }
      /*
       * PROD continua com a frase única; DEV ganha a causa (§5 do handoff).
       *
       * Sem isto não havia como saber, do aparelho, se aquele erro era 429,
       * timeout, parser ou action inválida — e "talvez fosse rede" não é
       * diagnóstico. A linha é só rótulo fechado e status: nenhum segredo, e
       * nada de conteúdo da conversa.
       */
      const info = error instanceof AIRequestError ? error.fields : undefined;
      setLastFailure(info ?? { code: 'UNKNOWN', stage: 'REQUEST' });
      /*
       * A frase segue o código, quando há um.
       *
       * Insistir "tente novamente" com a cota do provedor esgotada é mandar a
       * pessoa repetir um caminho sem saída. `describeAIFailure` devolve a
       * genérica para tudo o que não for esgotamento de cadeia — e nunca cita
       * modelo nenhum: qual deles falhou não é assunto de quem está viajando.
       */
      toast.error(describeAIFailure(info));
    }
  };

  const selectTrip = (tripId: string) => {
    selectAiTrip(tripId);
    setPickerOpen(false);
    // A conversa que aparece a seguir é a daquela viagem: contexto, histórico e
    // thread trocam juntos, então a próxima pergunta já sai com os dados novos
    // e nada de Paris atravessa para Tóquio.
    setDraft('');
    send.reset();
  };

  /**
   * Novo chat: a conversa anterior é apagada, não arquivada.
   *
   * A limpeza da tela acompanha o que o repositório fez — proposta aberta,
   * revisão, resultado e rascunho saem juntos. Deixar qualquer um deles vivo
   * apontaria para mensagens que já não existem.
   */
  const startNewChat = async () => {
    setConfirmNewChat(false);
    try {
      await newChat.mutateAsync();
      setDraft('');
      setReview(null);
      setResult(null);
      toast.success('Novo chat iniciado. A conversa anterior foi apagada.');
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
          disabled={tripsLoading || contextRestoring}
          newChatDisabled={!trip || newChat.isPending}
        />
      </View>

      <ScrollView
        ref={scrollRef}
        // Âncora estável para o teste de layout: o vão embaixo do composer era
        // uma propriedade desta coluna, e o teste precisa apontar para ela sem
        // depender da ordem em que as `ScrollView` da tela aparecem.
        testID="ai-conversation"
        /*
         * `flex: 1` é a correção do vão embaixo do composer.
         *
         * Sem ele, a `ScrollView` de uma coluna flexível se dimensiona pelo
         * conteúdo. Com a conversa vazia ou com duas mensagens ela ficava
         * baixinha, o composer subia colado nela, e o espaço que sobrava caía
         * **abaixo** do composer — o vão que aparecia em alguns estados e não
         * em outros. Com muitas mensagens a lista enchia a tela e o mesmo
         * layout parecia certo; era a mesma causa nos dois casos.
         *
         * Reivindicando o espaço, a `ScrollView` fica sempre entre a barra de
         * contexto e o composer, e a folga passa a viver dentro dela. O
         * composer encosta na navbar em todos os estados.
         */
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        // Com o teclado aberto, um toque em algo interativo deve acionar o
        // elemento, não ser consumido só para fechar o teclado (§14).
        keyboardShouldPersistTaps="handled"
        // Arrastar a conversa fecha o teclado, que é o gesto que o usuário já
        // espera — sem precisar de um botão só para isso (§15).
        keyboardDismissMode="on-drag"
        contentContainerStyle={{
          // `flexGrow` e não `flex`: com pouco conteúdo o contêiner cresce até
          // preencher a área visível (e o `justifyContent` decide onde a folga
          // fica); com muito, ele volta a crescer com o conteúdo e a lista
          // rola. `flex: 1` prenderia a altura e cortaria a conversa longa.
          flexGrow: 1,
          paddingHorizontal: theme.spacing.screen,
          paddingTop: theme.spacing.md,
          paddingBottom: theme.spacing.lg,
          gap: theme.spacing.md,
        }}
      >
        {/*
          Honest about which engine is answering (§1, §118) — e sobre POR QUE.

          As duas frases existem porque as duas situações são opostas e tinham
          o mesmo texto. "Modo demonstração" é a verdade quando ninguém
          configurou backend nenhum: a resposta local é a resposta certa, e
          não há defeito a corrigir. Já um aplicativo CONECTADO respondendo
          localmente é instalação pela metade — e chamar isso de demonstração
          escondia justamente a variável que faltava.
        */}
        {kind === 'local' ? (
          <InlineNotice
            icon={Info}
            tone={aiBackendState === 'unreachable' ? 'error' : 'warning'}
          >
            {aiBackendState === 'unreachable'
              ? 'O aplicativo está conectado ao backend, mas o endereço das Edge Functions não pôde ser resolvido — o Gemini não está sendo chamado. Defina EXPO_PUBLIC_BFF_URL. Enquanto isso, as respostas abaixo são geradas localmente a partir dos dados reais da sua viagem.'
              : 'Modo demonstração: nenhum backend está configurado, então as respostas são geradas localmente a partir dos dados reais da sua viagem. Defina EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_ANON_KEY para conversar com o Gemini.'}
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

        {lastFailure ? <DevFailureLine fields={lastFailure} /> : null}
      </ScrollView>

      {/*
        Sugestões rápidas e composer viajam juntos dentro da `DockAwareColumn`.

        É ela que mede onde esta coluna TERMINA em relação ao dock, e é dessa
        medida que sai a folga do composer — em vez de somar altura de barra
        com área segura e torcer para que a tela vá mesmo até o fundo da
        janela. Ver `DockMetrics.tsx`: as duas tentativas anteriores erraram
        exatamente nessa suposição (§9, §10 do handoff).
      */}
      <DockAwareColumn testID="ai-dock-column">
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
        A folga embaixo do composer é a SOBREPOSIÇÃO MEDIDA com o dock.

        `dock.clearance` é `max(0, fundo desta coluna − topo do dock)` mais o
        respiro. Quando a coluna já termina acima da barra, a sobreposição é
        zero e não se soma nada — que é o caso que as duas versões anteriores
        não sabiam distinguir e que produzia o vão de dezenas de pontos no
        aparelho (§9, §10 do handoff).

        Com o teclado aberto o dock sai de cena e `clearance` vira zero
        sozinho; sobra só o respiro, e quem levanta o composer é o
        `KeyboardAvoidingView`, que mede a sobreposição real do teclado (§11).
      */}
      <AIComposer
        value={draft}
        onChangeText={setDraft}
        onSubmit={(text) => void submit(text)}
        disabled={!trip}
        pending={send.isPending}
        disabledHint="Selecione uma viagem para conversar com a IA"
        paddingBottom={keyboardVisible ? theme.spacing.sm : dock.clearance}
      />
      </DockAwareColumn>

      {trip && review ? (
        <AIActionReviewSheet
          visible
          actions={review.actions}
          trip={trip}
          itinerary={itinerary}
          checklist={checklist}
          pending={runner.runningKey === review.messageId}
          isShared={(trip?.memberCount ?? 1) > 1}
          onCancel={() => setReview(null)}
          onConfirm={(actions, visibility) =>
            void applyActions(review.messageId, actions, visibility)
          }
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
        message="A conversa atual e suas mensagens serão apagadas."
        confirmLabel="Novo chat"
        cancelLabel="Cancelar"
        loading={newChat.isPending}
        onConfirm={() => void startNewChat()}
        onCancel={() => setConfirmNewChat(false)}
      />
    </KeyboardAvoidingView>
  );
}

/**
 * A causa do último erro, visível só em desenvolvimento (§5 do handoff).
 *
 * Formato fixo — `DEV · HTTP 429 · RATE_LIMIT · REQUEST` — porque o objetivo é
 * ser lido em voz alta de um aparelho na mão de alguém. Só status e rótulos
 * fechados: nenhum token, nenhuma chave, nenhum trecho da conversa.
 */
function DevFailureLine({ fields }: { fields: AITraceFields }) {
  const theme = useTheme();
  if (typeof __DEV__ === 'undefined' || !__DEV__) return null;

  return (
    <AppText
      testID="ai-dev-failure"
      variant="caption"
      color="tertiary"
      mono
      style={{ alignSelf: 'flex-start', paddingHorizontal: theme.spacing.xs }}
    >
      {formatAIFailure(fields)}
    </AppText>
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
