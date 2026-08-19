import { zodResolver } from '@hookform/resolvers/zod';
import {
  Bot,
  CalendarCheck,
  Info,
  RefreshCw,
  Send,
  Sparkles,
  UserRoundCheck,
} from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AdvisorCard } from '@/components/cards';
import { Markdown } from '@/components/Markdown';
import {
  AppText,
  Badge,
  BottomSheet,
  Button,
  Chip,
  ChipRow,
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
import { consultationSchema, type ConsultationInput } from '@/domain/schemas';
import type { Advisor } from '@/domain/types';
import { useAIConversation } from '@/hooks/useAI';
import { useAdvisors, useConsultations } from '@/hooks/useContent';
import { useCurrentTrip } from '@/hooks/useTrips';
import { formatLongDate } from '@/lib/date';
import { CONSULTATION_STATUS_HINT, CONSULTATION_STATUS_LABEL } from '@/lib/labels';
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
    <ScrollView
      showsVerticalScrollIndicator={false}
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
  );
}

/* ----------------------------------- AI ----------------------------------- */

function AITab() {
  const theme = useTheme();
  const toast = useToast();
  const { trip } = useCurrentTrip();
  const { messages, send, clear, kind, isLoading } = useAIConversation(trip);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120);
    return () => clearTimeout(timer);
  }, [messages.length, send.isPending]);

  const submit = async (text: string) => {
    const prompt = text.trim();
    if (!prompt || send.isPending) return;
    setDraft('');
    try {
      await send.mutateAsync(prompt);
    } catch {
      toast.error('Não foi possível obter uma resposta agora. Tente novamente.');
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
    >
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.screen,
          paddingTop: theme.spacing.xl,
          paddingBottom: theme.spacing.xl,
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

        {trip ? (
          <GlassCard elevation="flat">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
              <Sparkles size={18} color={theme.colors.primary} />
              <AppText variant="caption" color="secondary" style={{ flex: 1 }}>
                Contexto ativo: <AppText variant="caption" weight="bold">{trip.destinationCity}</AppText>
                {' '}· {formatLongDate(trip.startDate)}
              </AppText>
            </View>
          </GlassCard>
        ) : (
          <InlineNotice icon={Info}>
            Selecione uma viagem para que o assistente use seu roteiro, checklist e orçamento.
          </InlineNotice>
        )}

        {isLoading ? (
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
                Seu concierge de viagem. Pergunte sobre orçamento, roteiro ou o que ainda falta
                organizar.
              </AppText>
            </View>
          </GlassCard>
        ) : (
          messages.map((message) => <MessageBubble key={message.id} message={message} />)
        )}

        {send.isPending ? <TypingIndicator /> : null}
      </ScrollView>

      {/* Quick suggestions (§50) */}
      <View style={{ paddingLeft: theme.spacing.screen, paddingBottom: theme.spacing.sm }}>
        <ChipRow>
          {AI_SUGGESTIONS.map((suggestion) => (
            <Chip
              key={suggestion}
              label={suggestion}
              onPress={() => void submit(suggestion)}
            />
          ))}
          {messages.length > 0 ? (
            <Chip label="Limpar conversa" icon={RefreshCw} onPress={() => void clear.mutateAsync()} />
          ) : null}
        </ChipRow>
      </View>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          gap: theme.spacing.sm,
          paddingHorizontal: theme.spacing.screen,
          paddingBottom: DOCK_CLEARANCE - theme.spacing.md,
        }}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radius.input,
            borderWidth: 1,
            borderColor: theme.colors.border,
            paddingHorizontal: theme.spacing.lg,
            maxHeight: 120,
            justifyContent: 'center',
          }}
        >
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Pergunte sobre sua viagem"
            placeholderTextColor={theme.colors.textTertiary}
            accessibilityLabel="Mensagem para a Easy Trip IA"
            multiline
            style={{
              fontFamily: theme.fontFamily.body,
              fontSize: theme.typography.body.size,
              color: theme.colors.textPrimary,
              paddingVertical: theme.spacing.md,
              minHeight: 48,
            }}
          />
        </View>

        <Pressable
          onPress={() => void submit(draft)}
          disabled={!draft.trim() || send.isPending}
          accessibilityRole="button"
          accessibilityLabel="Enviar mensagem"
          accessibilityState={{ disabled: !draft.trim() || send.isPending }}
          style={({ pressed }) => ({
            width: 48,
            height: 48,
            borderRadius: 24,
            backgroundColor: theme.colors.primary,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: !draft.trim() || send.isPending ? 0.4 : pressed ? 0.8 : 1,
          })}
        >
          <Send size={20} color={theme.colors.textOnPrimary} />
        </Pressable>
      </View>
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
        maxWidth: '88%',
        backgroundColor: isUser ? theme.colors.primary : theme.colors.surface,
        borderRadius: theme.radius.card,
        borderTopRightRadius: isUser ? 6 : theme.radius.card,
        borderTopLeftRadius: isUser ? theme.radius.card : 6,
        borderWidth: isUser ? 0 : 1,
        borderColor: theme.colors.border,
        padding: theme.spacing.lg,
      }}
      accessible
      accessibilityLabel={`${isUser ? 'Você' : 'Easy Trip IA'}: ${message.content}`}
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
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.card,
        borderWidth: 1,
        borderColor: theme.colors.border,
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
