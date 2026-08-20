import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { ListChecks, Plus, Trash2 } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { ScrollView, View } from 'react-native';

import { ChecklistRow } from '@/components/cards';
import {
  AppText,
  BottomSheet,
  Button,
  Chip,
  ChipRow,
  ConfirmDialog,
  DateField,
  EmptyState,
  FadeIn,
  ErrorState,
  GlassCard,
  FloatingActionButton,
  ProgressBar,
  SectionHeader,
  SelectField,
  SkeletonList,
  TextField,
  useToast,
} from '@/components/ui';
import { getChecklistProgress } from '@/domain/selectors';
import { checklistItemSchema, type ChecklistItemInput } from '@/domain/schemas';
import {
  CHECKLIST_CATEGORIES,
  type ChecklistCategory,
  type ChecklistItem,
  type Priority,
} from '@/domain/types';
import { TripHero, TripScreenShell, TripTabs } from '@/features/trip/TripScaffold';
import { RoteiroModules } from '@/features/trip/RoteiroModules';
import { useTripRoute } from '@/features/trip/useTripRoute';
import { useChecklist, useChecklistMutations } from '@/hooks/useTripData';
import { CHECKLIST_CATEGORY_LABEL, PRIORITY_LABEL } from '@/lib/labels';
import { useTheme } from '@/theme';

type Filter = 'all' | ChecklistCategory;

export default function ChecklistScreen() {
  const theme = useTheme();
  const router = useRouter();
  const toast = useToast();
  const { tripId, trip, isLoading, isError, notFound, refetch } = useTripRoute();

  const { data: items = [], isLoading: loadingItems } = useChecklist(tripId);
  const mutations = useChecklistMutations(tripId);

  const [filter, setFilter] = useState<Filter>('all');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<ChecklistItem | null>(null);
  const [deleting, setDeleting] = useState<ChecklistItem | null>(null);

  const progress = getChecklistProgress(items);
  const pending = progress.total - progress.completed;

  const grouped = useMemo(() => {
    const visible = filter === 'all' ? items : items.filter((item) => item.category === filter);
    const map = new Map<ChecklistCategory, ChecklistItem[]>();
    for (const item of visible) {
      map.set(item.category, [...(map.get(item.category) ?? []), item]);
    }
    // Pending first inside each category, but completed items stay visible (§36).
    for (const [, list] of map) {
      list.sort((a, b) => Number(a.completed) - Number(b.completed));
    }
    return [...map.entries()];
  }, [items, filter]);

  if (isLoading || isError || notFound || !trip) {
    return (
      <TripScreenShell>
        <View style={{ padding: theme.spacing.screen, paddingTop: 100 }}>
          {isLoading ? (
            <SkeletonList count={3} lines={2} />
          ) : (
            <GlassCard>
              <ErrorState
                title={notFound ? 'Viagem não encontrada' : 'Não foi possível carregar'}
                message={
                  notFound
                    ? 'Esta viagem pode ter sido excluída.'
                    : 'Verifique sua conexão e tente novamente.'
                }
                onRetry={notFound ? () => router.replace('/(tabs)/trips') : () => void refetch()}
              />
            </GlassCard>
          )}
        </View>
      </TripScreenShell>
    );
  }

  const toggle = async (item: ChecklistItem) => {
    try {
      await mutations.update.mutateAsync({ id: item.id, patch: { completed: !item.completed } });
    } catch {
      toast.error('Não foi possível atualizar o item.');
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await mutations.remove.mutateAsync(deleting.id);
      toast.success('Item excluído');
      setDeleting(null);
    } catch {
      toast.error('Não foi possível excluir o item.');
    }
  };

  // Um único CTA para a primeira criação: quando o empty state já oferece a
  // ação, o FAB logo abaixo seria o mesmo botão duas vezes (§20). Assim que
  // existe conteúdo, o FAB volta ao comportamento normal.
  const emptyCtaVisible = !loadingItems && items.length === 0;

  return (
    <TripScreenShell>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        <TripHero trip={trip} />
        <TripTabs tripId={tripId} active="itinerary" />
        <RoteiroModules tripId={tripId} active="checklist" />

        <FadeIn style={{ paddingHorizontal: theme.spacing.screen, gap: theme.spacing.lg }}>
          {items.length > 0 ? (
            <GlassCard>
              <View style={{ gap: theme.spacing.md }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <AppText variant="body" weight="semibold">
                    Progresso
                  </AppText>
                  <AppText variant="bodySmall" color="secondary" mono>
                    {progress.completed}/{progress.total}
                  </AppText>
                </View>
                <ProgressBar
                  percent={progress.percent}
                  tone={progress.percent === 100 ? 'success' : 'brand'}
                  label="Progresso do checklist"
                />
                <AppText variant="caption" color="secondary">
                  {pending === 0
                    ? 'Tudo pronto para embarcar.'
                    : `${pending} ${pending === 1 ? 'item pendente' : 'itens pendentes'}`}
                </AppText>
              </View>
            </GlassCard>
          ) : null}

          {items.length > 0 ? (
            <View style={{ marginHorizontal: -theme.spacing.screen, paddingLeft: theme.spacing.screen }}>
              <ChipRow>
                <Chip label="Todos" selected={filter === 'all'} onPress={() => setFilter('all')} />
                {CHECKLIST_CATEGORIES.map((category) => (
                  <Chip
                    key={category}
                    label={CHECKLIST_CATEGORY_LABEL[category]}
                    selected={filter === category}
                    onPress={() => setFilter(category)}
                  />
                ))}
              </ChipRow>
            </View>
          ) : null}

          {loadingItems ? (
            <SkeletonList count={4} lines={1} />
          ) : items.length === 0 ? (
            <EmptyState
              icon={ListChecks}
              title="Seu checklist está vazio"
              message="Documentos, saúde, mala, reservas — organize o que não pode ser esquecido."
              actionLabel="Adicionar primeiro item"
              onAction={() => setEditorOpen(true)}
            />
          ) : (
            grouped.map(([category, list]) => (
              <View key={category} style={{ gap: theme.spacing.sm }}>
                <SectionHeader
                  title={CHECKLIST_CATEGORY_LABEL[category]}
                  subtitle={`${list.filter((i) => i.completed).length}/${list.length} concluídos`}
                />
                {list.map((item) => (
                  <ChecklistRow
                    key={item.id}
                    item={item}
                    onToggle={() => void toggle(item)}
                    onMenu={() => {
                      setEditing(item);
                      setEditorOpen(true);
                    }}
                  />
                ))}
              </View>
            ))
          )}
        </FadeIn>
      </ScrollView>

      {emptyCtaVisible ? null : (
        <FloatingActionButton
          icon={Plus}
          label="Item"
          onPress={() => {
            setEditing(null);
            setEditorOpen(true);
          }}
        />
      )}

      <ChecklistEditorSheet
        visible={editorOpen}
        item={editing}
        mutations={mutations}
        onClose={() => {
          setEditorOpen(false);
          setEditing(null);
        }}
        onSaved={() => {
          setEditorOpen(false);
          toast.success(editing ? 'Item atualizado' : 'Item adicionado');
          setEditing(null);
        }}
        onDelete={(item) => {
          setEditorOpen(false);
          setDeleting(item);
        }}
      />

      <ConfirmDialog
        visible={Boolean(deleting)}
        title="Excluir item?"
        message={`"${deleting?.label}" será removido do checklist.`}
        confirmLabel="Excluir"
        destructive
        loading={mutations.remove.isPending}
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleting(null)}
      />
    </TripScreenShell>
  );
}

function ChecklistEditorSheet({
  visible,
  item,
  mutations,
  onClose,
  onSaved,
  onDelete,
}: {
  visible: boolean;
  item: ChecklistItem | null;
  mutations: ReturnType<typeof useChecklistMutations>;
  onClose: () => void;
  onSaved: () => void;
  onDelete: (item: ChecklistItem) => void;
}) {
  const theme = useTheme();
  const toast = useToast();

  const { control, handleSubmit, reset, formState } = useForm<ChecklistItemInput>({
    resolver: zodResolver(checklistItemSchema),
    values: {
      label: item?.label ?? '',
      category: item?.category ?? 'documentos',
      priority: item?.priority,
      dueDate: item?.dueDate,
    },
  });

  const onSubmit = async (values: ChecklistItemInput) => {
    try {
      if (item) {
        await mutations.update.mutateAsync({
          id: item.id,
          patch: {
            label: values.label,
            category: values.category as ChecklistCategory,
            priority: values.priority as Priority | undefined,
            dueDate: values.dueDate,
          },
        });
      } else {
        await mutations.create.mutateAsync({
          label: values.label,
          category: values.category as ChecklistCategory,
          priority: values.priority as Priority | undefined,
          dueDate: values.dueDate,
          completed: false,
        });
      }
      reset();
      onSaved();
    } catch {
      toast.error('Não foi possível salvar o item.');
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={item ? 'Editar item' : 'Novo item'}
    >
      <View style={{ gap: theme.spacing.lg }}>
        <Controller
          control={control}
          name="label"
          render={({ field, fieldState }) => (
            <TextField
              label="Item"
              placeholder="Ex.: Renovar passaporte"
              value={field.value}
              onChangeText={field.onChange}
              error={fieldState.error?.message}
              required
            />
          )}
        />

        <Controller
          control={control}
          name="category"
          render={({ field, fieldState }) => (
            <SelectField
              label="Categoria"
              value={field.value}
              onChange={field.onChange}
              error={fieldState.error?.message}
              options={CHECKLIST_CATEGORIES.map((category) => ({
                value: category,
                label: CHECKLIST_CATEGORY_LABEL[category],
              }))}
              required
            />
          )}
        />

        <Controller
          control={control}
          name="priority"
          render={({ field, fieldState }) => (
            <SelectField
              label="Prioridade"
              value={field.value}
              onChange={field.onChange}
              error={fieldState.error?.message}
              placeholder="Normal"
              options={(['low', 'medium', 'high'] as const).map((priority) => ({
                value: priority,
                label: PRIORITY_LABEL[priority],
              }))}
            />
          )}
        />

        <Controller
          control={control}
          name="dueDate"
          render={({ field, fieldState }) => (
            <DateField
              label="Prazo"
              value={field.value}
              onChange={field.onChange}
              error={fieldState.error?.message}
              placeholder="Sem prazo"
            />
          )}
        />

        <Button
          label={item ? 'Salvar alterações' : 'Adicionar item'}
          size="lg"
          fullWidth
          loading={formState.isSubmitting}
          onPress={handleSubmit(onSubmit)}
          haptic
        />

        {item ? (
          <Button
            label="Excluir item"
            variant="ghost"
            icon={Trash2}
            fullWidth
            onPress={() => onDelete(item)}
          />
        ) : null}
      </View>
    </BottomSheet>
  );
}
