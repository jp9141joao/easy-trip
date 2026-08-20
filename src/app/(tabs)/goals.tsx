import { zodResolver } from '@hookform/resolvers/zod';

import { MapPinned, Plus, Target, Trash2 } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { FlatList, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GoalCard } from '@/components/cards';
import {
  AppText,
  BottomSheet,
  Button,
  ConfirmDialog,
  DateField,
  EmptyState,
  ErrorState,
  FloatingActionButton,
  GlassCard,
  MoneyField,
  PageLabel,
  SectionHeader,
  SelectField,
  SkeletonList,
  StatCard,
  TextField,
  useToast,
} from '@/components/ui';
import { AuroraBackground } from '@/components/ui/Surface';
import { DOCK_CLEARANCE } from '@/constants/layout';
import { getGoalProgress, isGoalComplete } from '@/domain/selectors';
import { goalSchema, type GoalInput } from '@/domain/schemas';
import { GOAL_TYPES, type Goal, type GoalType } from '@/domain/types';
import { useGoalMutations, useGoals } from '@/hooks/useGoals';
import { formatMoney, parseMoneyInput } from '@/lib/currency';
import { GOAL_TYPE_LABEL } from '@/lib/labels';
import { useTheme } from '@/theme';

export default function GoalsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();

  const { data: goals = [], isLoading, isError, refetch } = useGoals();
  const mutations = useGoalMutations();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Goal | null>(null);
  const [contributing, setContributing] = useState<Goal | null>(null);
  const [contribution, setContribution] = useState<number | undefined>();
  const [deleting, setDeleting] = useState<Goal | null>(null);

  const active = useMemo(() => goals.filter((goal) => !isGoalComplete(goal)), [goals]);
  const completed = useMemo(() => goals.filter(isGoalComplete), [goals]);
  // "Destinos desejados" stays a section of Metas rather than a fake entity (§44).
  const destinations = useMemo(() => goals.filter((goal) => goal.type === 'destino'), [goals]);

  const totalSaved = useMemo(
    () =>
      goals
        .filter((goal) => goal.type === 'economia')
        .reduce((sum, goal) => sum + goal.currentValue, 0),
    [goals],
  );

  const openEditor = (goal?: Goal) => {
    setEditing(goal ?? null);
    setEditorOpen(true);
  };

  const handleContribute = async () => {
    if (!contributing || !contribution) return;
    try {
      await mutations.addProgress.mutateAsync({ goal: contributing, amount: contribution });
      toast.success('Progresso atualizado');
      setContributing(null);
      setContribution(undefined);
    } catch {
      toast.error('Não foi possível registrar o progresso. Tente novamente.');
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await mutations.remove.mutateAsync(deleting.id);
      toast.success('Meta excluída');
      setDeleting(null);
    } catch {
      toast.error('Não foi possível excluir a meta.');
    }
  };

  // Um único CTA para a primeira criação: quando o empty state já oferece a
  // ação, o FAB logo abaixo seria o mesmo botão duas vezes (§20). Assim que
  // existe conteúdo, o FAB volta ao comportamento normal.
  const emptyCtaVisible = !isLoading && !isError && active.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AuroraBackground />

      <FlatList
        data={active}
        keyExtractor={(goal) => goal.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: insets.top + theme.spacing.sm,
          paddingHorizontal: theme.spacing.screen,
          paddingBottom: DOCK_CLEARANCE + theme.spacing['4xl'],
        }}
        ListHeaderComponent={
          <View style={{ gap: theme.spacing.xl, marginBottom: theme.spacing.lg }}>
            <View>
              <PageLabel>Seus objetivos</PageLabel>
              <AppText variant="h1">Objetivos</AppText>
              <AppText variant="bodySmall" color="secondary">
                Metas de economia, destinos e preparação
              </AppText>
            </View>

            {goals.length > 0 ? (
              <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
                <StatCard
                  label="Metas ativas"
                  value={String(active.length)}
                  icon={Target}
                  tone="brand"
                />
                <StatCard
                  label="Concluídas"
                  value={String(completed.length)}
                  tone="success"
                />
                <StatCard
                  label="Economizado"
                  value={formatMoney(totalSaved, 'BRL', { compact: true })}
                  tone="accent"
                />
              </View>
            ) : null}

            {active.length > 0 ? <SectionHeader title="Em andamento" /> : null}
          </View>
        }
        renderItem={({ item }) => (
          <GoalCard goal={item} onPress={() => setContributing(item)} />
        )}
        ListEmptyComponent={
          isLoading ? (
            <SkeletonList count={3} lines={2} />
          ) : isError ? (
            <GlassCard>
              <ErrorState
                message="Não foi possível carregar seus objetivos. Verifique sua conexão."
                onRetry={() => void refetch()}
              />
            </GlassCard>
          ) : goals.length === 0 ? (
            <GlassCard>
              <EmptyState
                icon={Target}
                title="Nenhum objetivo ainda"
                message="Crie uma meta de economia para a próxima viagem ou registre um destino que você quer conhecer."
                actionLabel="Criar primeira meta"
                onAction={() => openEditor()}
              />
            </GlassCard>
          ) : (
            <GlassCard>
              <EmptyState
                icon={Target}
                title="Todas as metas concluídas"
                message="Parabéns! Que tal definir a próxima?"
                actionLabel="Nova meta"
                onAction={() => openEditor()}
                compact
              />
            </GlassCard>
          )
        }
        ListFooterComponent={
          <View style={{ gap: theme.spacing.xl, marginTop: theme.spacing.xl }}>
            {destinations.length > 0 ? (
              <View>
                <SectionHeader
                  title="Destinos desejados"
                  subtitle="Metas do tipo destino"
                />
                <View style={{ gap: theme.spacing.md }}>
                  {destinations.map((goal) => {
                    const progress = getGoalProgress(goal);
                    return (
                      <GlassCard
                        key={`dest-${goal.id}`}
                        onPress={() => setContributing(goal)}
                        accessibilityLabel={`Destino desejado: ${goal.title}`}
                      >
                        <View
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: theme.spacing.md,
                          }}
                        >
                          <View
                            style={{
                              width: 40,
                              height: 40,
                              borderRadius: 20,
                              backgroundColor: theme.colors.accentSoft,
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <MapPinned size={18} color={theme.colors.accent} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <AppText variant="body" weight="semibold" numberOfLines={1}>
                              {goal.title}
                            </AppText>
                            <AppText variant="caption" color="secondary">
                              {Math.round(progress.percent)}% do planejamento
                            </AppText>
                          </View>
                        </View>
                      </GlassCard>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {completed.length > 0 ? (
              <View>
                <SectionHeader title="Concluídas" />
                {completed.map((goal) => (
                  <GoalCard key={goal.id} goal={goal} onPress={() => setContributing(goal)} />
                ))}
              </View>
            ) : null}
          </View>
        }
      />

      {emptyCtaVisible ? null : (
        <FloatingActionButton
          icon={Plus}
          label="Nova meta"
          onPress={() => openEditor()}
          bottomOffset={DOCK_CLEARANCE - theme.spacing.md}
        />
      )}

      <GoalEditorSheet
        visible={editorOpen}
        goal={editing}
        onClose={() => setEditorOpen(false)}
        onSaved={() => {
          setEditorOpen(false);
          toast.success(editing ? 'Meta atualizada' : 'Meta criada');
        }}
      />

      {/* Contribution / detail sheet */}
      <BottomSheet
        visible={Boolean(contributing)}
        onClose={() => {
          setContributing(null);
          setContribution(undefined);
        }}
        title={contributing?.title}
        subtitle={contributing ? GOAL_TYPE_LABEL[contributing.type] : undefined}
      >
        {contributing ? (
          <View style={{ gap: theme.spacing.lg }}>
            <GlassCard elevation="flat">
              <View style={{ gap: 4 }}>
                <AppText variant="caption" color="secondary">
                  Progresso atual
                </AppText>
                <AppText variant="h2" mono weight="bold">
                  {contributing.unit === 'R$'
                    ? formatMoney(contributing.currentValue, 'BRL')
                    : `${contributing.currentValue} ${contributing.unit}`}
                </AppText>
                <AppText variant="caption" color="tertiary">
                  Meta:{' '}
                  {contributing.unit === 'R$'
                    ? formatMoney(contributing.targetValue, 'BRL')
                    : `${contributing.targetValue} ${contributing.unit}`}
                </AppText>
              </View>
            </GlassCard>

            <MoneyField
              label="Adicionar progresso"
              value={contribution}
              onChange={setContribution}
              currency="BRL"
              helper={`Valor a somar em ${contributing.unit}`}
            />

            <Button
              label="Registrar progresso"
              fullWidth
              disabled={!contribution}
              loading={mutations.addProgress.isPending}
              onPress={() => void handleContribute()}
              haptic
            />

            <Button
              label="Editar meta"
              variant="secondary"
              fullWidth
              onPress={() => {
                const goal = contributing;
                setContributing(null);
                openEditor(goal);
              }}
            />

            <Button
              label="Excluir meta"
              variant="ghost"
              icon={Trash2}
              fullWidth
              onPress={() => {
                setDeleting(contributing);
                setContributing(null);
              }}
              style={{ alignSelf: 'stretch' }}
            />
          </View>
        ) : null}
      </BottomSheet>

      <ConfirmDialog
        visible={Boolean(deleting)}
        title={`Excluir "${deleting?.title}"?`}
        message="Essa meta e todo o progresso registrado serão removidos. Essa ação não poderá ser desfeita."
        confirmLabel="Excluir"
        destructive
        loading={mutations.remove.isPending}
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleting(null)}
      />
    </View>
  );
}

/* ------------------------------- goal editor ------------------------------ */

function GoalEditorSheet({
  visible,
  goal,
  onClose,
  onSaved,
}: {
  visible: boolean;
  goal: Goal | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const theme = useTheme();
  const toast = useToast();
  const mutations = useGoalMutations();

  const { control, handleSubmit, reset, formState } = useForm<GoalInput>({
    resolver: zodResolver(goalSchema),
    values: {
      type: goal?.type ?? 'economia',
      title: goal?.title ?? '',
      targetValue: goal?.targetValue ?? 0,
      currentValue: goal?.currentValue ?? 0,
      unit: goal?.unit ?? 'R$',
      deadline: goal?.deadline,
      tripId: goal?.tripId,
    },
  });

  const onSubmit = async (values: GoalInput) => {
    try {
      if (goal) {
        await mutations.update.mutateAsync({
          id: goal.id,
          patch: {
            type: values.type as GoalType,
            title: values.title,
            targetValue: values.targetValue,
            currentValue: values.currentValue,
            unit: values.unit,
            deadline: values.deadline,
          },
        });
      } else {
        await mutations.create.mutateAsync({
          type: values.type as GoalType,
          title: values.title,
          targetValue: values.targetValue,
          currentValue: values.currentValue,
          unit: values.unit,
          deadline: values.deadline,
          tripId: values.tripId,
        });
      }
      reset();
      onSaved();
    } catch {
      toast.error('Não foi possível salvar a meta. Tente novamente.');
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={goal ? 'Editar meta' : 'Nova meta'}
      subtitle="Defina um alvo objetivo para acompanhar o progresso"
    >
      <View style={{ gap: theme.spacing.lg }}>
        <Controller
          control={control}
          name="type"
          render={({ field, fieldState }) => (
            <SelectField
              label="Tipo"
              value={field.value}
              onChange={field.onChange}
              error={fieldState.error?.message}
              options={GOAL_TYPES.map((type) => ({ value: type, label: GOAL_TYPE_LABEL[type] }))}
              required
            />
          )}
        />

        <Controller
          control={control}
          name="title"
          render={({ field, fieldState }) => (
            <TextField
              label="Título"
              placeholder="Ex.: Economizar para Kyoto"
              value={field.value}
              onChangeText={field.onChange}
              error={fieldState.error?.message}
              required
            />
          )}
        />

        <Controller
          control={control}
          name="unit"
          render={({ field, fieldState }) => (
            <TextField
              label="Unidade"
              placeholder="R$, dias, países..."
              value={field.value}
              onChangeText={field.onChange}
              error={fieldState.error?.message}
              helper="Use R$ para metas financeiras."
              required
            />
          )}
        />

        <Controller
          control={control}
          name="targetValue"
          render={({ field, fieldState }) => (
            <TextField
              label="Meta"
              placeholder="0"
              value={field.value ? String(field.value) : ''}
              onChangeText={(text) => field.onChange(parseMoneyInput(text) ?? 0)}
              error={fieldState.error?.message}
              keyboardType="numeric"
              required
            />
          )}
        />

        <Controller
          control={control}
          name="currentValue"
          render={({ field, fieldState }) => (
            <TextField
              label="Progresso atual"
              placeholder="0"
              value={field.value ? String(field.value) : ''}
              onChangeText={(text) => field.onChange(parseMoneyInput(text) ?? 0)}
              error={fieldState.error?.message}
              keyboardType="numeric"
            />
          )}
        />

        <Controller
          control={control}
          name="deadline"
          render={({ field, fieldState }) => (
            <DateField
              label="Prazo"
              value={field.value}
              onChange={field.onChange}
              error={fieldState.error?.message}
              placeholder="Sem prazo definido"
            />
          )}
        />

        <Button
          label={goal ? 'Salvar alterações' : 'Criar meta'}
          fullWidth
          size="lg"
          loading={formState.isSubmitting}
          onPress={handleSubmit(onSubmit)}
          haptic
        />
      </View>
    </BottomSheet>
  );
}
