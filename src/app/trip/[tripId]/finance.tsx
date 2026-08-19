import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { Plus, Receipt, Trash2, TriangleAlert } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { ScrollView, View } from 'react-native';

import { ExpenseCard } from '@/components/cards';
import {
  AppText,
  BottomSheet,
  Button,
  Chip,
  ChipRow,
  ConfirmDialog,
  DateField,
  EmptyState,
  ErrorState,
  FloatingActionButton,
  GlassCard,
  InlineNotice,
  MoneyField,
  ProgressBar,
  SearchInput,
  SectionHeader,
  SelectField,
  SkeletonList,
  TextField,
  useToast,
} from '@/components/ui';
import {
  getBudgetUsagePercent,
  getExpensesByCategory,
  getRemainingBudget,
  getTripTotalSpent,
  hasUnconvertedExpenses,
  isOverBudget,
} from '@/domain/selectors';
import { expenseSchema, type ExpenseInput } from '@/domain/schemas';
import {
  CURRENCIES,
  EXPENSE_CATEGORIES,
  type CurrencyCode,
  type Expense,
  type ExpenseCategory,
} from '@/domain/types';
import { TripHero, TripScreenShell, TripTabs } from '@/features/trip/TripScaffold';
import { useTripRoute } from '@/features/trip/useTripRoute';
import { useExpenseMutations, useExpenses } from '@/hooks/useTripData';
import { formatMoney } from '@/lib/currency';
import { todayISO } from '@/lib/date';
import { EXPENSE_CATEGORY_LABEL } from '@/lib/labels';
import { isRateSupported } from '@/services/currency';
import { useTheme } from '@/theme';

type Filter = 'all' | ExpenseCategory;

export default function FinanceScreen() {
  const theme = useTheme();
  const router = useRouter();
  const toast = useToast();
  const { tripId, trip, isLoading, isError, notFound, refetch } = useTripRoute();

  const { data: expenses = [], isLoading: loadingExpenses } = useExpenses(tripId);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [deleting, setDeleting] = useState<Expense | null>(null);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return expenses.filter((expense) => {
      if (filter !== 'all' && expense.category !== filter) return false;
      if (!term) return true;
      return expense.description.toLowerCase().includes(term);
    });
  }, [expenses, filter, search]);

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

  // Every figure below is derived — nothing is stored in parallel (§38).
  const spent = getTripTotalSpent(expenses, trip);
  const remaining = getRemainingBudget(expenses, trip);
  const percent = getBudgetUsagePercent(expenses, trip);
  const over = isOverBudget(expenses, trip);
  const byCategory = getExpensesByCategory(expenses, trip);
  const unconverted = hasUnconvertedExpenses(expenses, trip);

  return (
    <TripScreenShell>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        <TripHero trip={trip} spent={spent} />
        <TripTabs tripId={tripId} active="finance" />

        <View style={{ paddingHorizontal: theme.spacing.screen, gap: theme.spacing.lg }}>
          {/* -------------------------- Budget summary ------------------------- */}
          <GlassCard elevation="md">
            <View style={{ gap: theme.spacing.lg }}>
              <View style={{ alignItems: 'center', gap: 2 }}>
                <AppText variant="caption" color="secondary" uppercase>
                  {over ? 'Orçamento excedido em' : 'Saldo restante'}
                </AppText>
                <AppText
                  variant="display"
                  mono
                  weight="bold"
                  color={over ? 'error' : 'primary'}
                  adjustsFontSizeToFit
                  numberOfLines={1}
                >
                  {/* Negative values are shown, never clamped to zero (§39). */}
                  {formatMoney(remaining, trip.budgetCurrency)}
                </AppText>
              </View>

              <ProgressBar
                percent={percent}
                tone={over ? 'error' : percent > 80 ? 'warning' : 'brand'}
                height={10}
                label="Uso do orçamento"
              />

              {over ? (
                <InlineNotice icon={TriangleAlert} tone="error">
                  Orçamento excedido. Seus gastos ultrapassaram o valor planejado para esta viagem.
                </InlineNotice>
              ) : null}

              <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
                <SummaryTile
                  label="Orçamento"
                  value={formatMoney(trip.budgetTotal, trip.budgetCurrency)}
                />
                <SummaryTile label="Gasto" value={formatMoney(spent, trip.budgetCurrency)} />
                <SummaryTile label="Usado" value={`${Math.round(percent)}%`} />
              </View>
            </View>
          </GlassCard>

          {unconverted ? (
            <InlineNotice icon={TriangleAlert} tone="warning">
              Algumas despesas em outra moeda não puderam ser convertidas porque a cotação estava
              indisponível. Elas estão somadas pelo valor original.
            </InlineNotice>
          ) : null}

          {/* --------------------------- By category --------------------------- */}
          {byCategory.length > 0 ? (
            <GlassCard>
              <SectionHeader title="Por categoria" />
              <View style={{ gap: theme.spacing.md }}>
                {byCategory.map((row) => (
                  <View key={row.category} style={{ gap: 6 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <AppText variant="bodySmall">
                        {EXPENSE_CATEGORY_LABEL[row.category]}
                      </AppText>
                      <AppText variant="bodySmall" mono weight="semibold">
                        {formatMoney(row.total, trip.budgetCurrency)}
                      </AppText>
                    </View>
                    <ProgressBar
                      percent={row.ratio * 100}
                      height={6}
                      label={`${EXPENSE_CATEGORY_LABEL[row.category]}: ${Math.round(row.ratio * 100)}%`}
                    />
                  </View>
                ))}
              </View>
            </GlassCard>
          ) : null}

          {/* ---------------------------- Expenses ----------------------------- */}
          <SectionHeader
            title="Despesas"
            subtitle={`${expenses.length} ${expenses.length === 1 ? 'registro' : 'registros'}`}
          />

          {expenses.length > 0 ? (
            <>
              <SearchInput
                value={search}
                onChangeText={setSearch}
                placeholder="Buscar despesa"
                accessibilityLabel="Buscar despesa"
              />
              <View
                style={{ marginHorizontal: -theme.spacing.screen, paddingLeft: theme.spacing.screen }}
              >
                <ChipRow>
                  <Chip label="Todas" selected={filter === 'all'} onPress={() => setFilter('all')} />
                  {EXPENSE_CATEGORIES.map((category) => (
                    <Chip
                      key={category}
                      label={EXPENSE_CATEGORY_LABEL[category]}
                      selected={filter === category}
                      onPress={() => setFilter(category)}
                    />
                  ))}
                </ChipRow>
              </View>
            </>
          ) : null}

          {loadingExpenses ? (
            <SkeletonList count={3} lines={2} />
          ) : expenses.length === 0 ? (
            <GlassCard>
              <EmptyState
                icon={Receipt}
                title="Nenhuma despesa registrada"
                message="Registre os gastos assim que acontecerem — é o que mantém o orçamento real."
                actionLabel="Adicionar gasto"
                onAction={() => setEditorOpen(true)}
              />
            </GlassCard>
          ) : visible.length === 0 ? (
            <GlassCard>
              <EmptyState
                icon={Receipt}
                title="Nenhuma despesa encontrada"
                message="Ajuste a busca ou o filtro de categoria."
                compact
              />
            </GlassCard>
          ) : (
            visible.map((expense) => (
              <ExpenseCard
                key={expense.id}
                expense={expense}
                budgetCurrency={trip.budgetCurrency}
                onPress={() => {
                  setEditing(expense);
                  setEditorOpen(true);
                }}
              />
            ))
          )}
        </View>
      </ScrollView>

      <FloatingActionButton
        icon={Plus}
        label="Gasto"
        onPress={() => {
          setEditing(null);
          setEditorOpen(true);
        }}
      />

      <ExpenseEditorSheet
        visible={editorOpen}
        expense={editing}
        trip={trip}
        onClose={() => {
          setEditorOpen(false);
          setEditing(null);
        }}
        onSaved={() => {
          setEditorOpen(false);
          toast.success(editing ? 'Despesa atualizada' : 'Despesa adicionada');
          setEditing(null);
        }}
        onDelete={(expense) => {
          setEditorOpen(false);
          setDeleting(expense);
        }}
      />

      <DeleteExpenseDialog
        expense={deleting}
        trip={trip}
        onDone={() => setDeleting(null)}
      />
    </TripScreenShell>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.colors.surfaceMuted,
        borderRadius: theme.radius.smallCard,
        padding: theme.spacing.md,
        gap: 2,
      }}
    >
      <AppText variant="caption" color="tertiary" numberOfLines={1}>
        {label}
      </AppText>
      <AppText variant="bodySmall" weight="bold" mono numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </AppText>
    </View>
  );
}

function DeleteExpenseDialog({
  expense,
  trip,
  onDone,
}: {
  expense: Expense | null;
  trip: Parameters<typeof useExpenseMutations>[0];
  onDone: () => void;
}) {
  const toast = useToast();
  const mutations = useExpenseMutations(trip);

  return (
    <ConfirmDialog
      visible={Boolean(expense)}
      title="Excluir despesa?"
      message={`"${expense?.description}" será removida e o saldo será recalculado.`}
      confirmLabel="Excluir"
      destructive
      loading={mutations.remove.isPending}
      onConfirm={async () => {
        if (!expense) return;
        try {
          await mutations.remove.mutateAsync(expense.id);
          toast.success('Despesa excluída');
          onDone();
        } catch {
          toast.error('Não foi possível excluir a despesa.');
        }
      }}
      onCancel={onDone}
    />
  );
}

/* ------------------------------ expense editor ---------------------------- */

function ExpenseEditorSheet({
  visible,
  expense,
  trip,
  onClose,
  onSaved,
  onDelete,
}: {
  visible: boolean;
  expense: Expense | null;
  trip: Parameters<typeof useExpenseMutations>[0];
  onClose: () => void;
  onSaved: () => void;
  onDelete: (expense: Expense) => void;
}) {
  const theme = useTheme();
  const toast = useToast();
  const mutations = useExpenseMutations(trip);

  const { control, handleSubmit, reset, formState } = useForm<ExpenseInput>({
    resolver: zodResolver(expenseSchema),
    values: {
      description: expense?.description ?? '',
      category: expense?.category ?? 'alimentacao',
      amount: expense?.amount ?? 0,
      currency: expense?.currency ?? trip.budgetCurrency,
      transactionDate: expense?.transactionDate ?? todayISO(),
    },
  });

  const chosenCurrency = useWatch({ control, name: 'currency' }) as CurrencyCode;
  const needsConversion = chosenCurrency !== trip.budgetCurrency;
  const rateUnavailable =
    needsConversion && (!isRateSupported(chosenCurrency) || !isRateSupported(trip.budgetCurrency));

  const onSubmit = async (values: ExpenseInput) => {
    try {
      if (expense) {
        await mutations.update.mutateAsync({
          id: expense.id,
          patch: {
            description: values.description,
            category: values.category as ExpenseCategory,
            amount: values.amount,
            currency: values.currency as CurrencyCode,
            transactionDate: values.transactionDate,
          },
        });
      } else {
        await mutations.create.mutateAsync({
          description: values.description,
          category: values.category as ExpenseCategory,
          amount: values.amount,
          currency: values.currency as CurrencyCode,
          transactionDate: values.transactionDate,
        });
      }
      reset();
      onSaved();
    } catch {
      toast.error('Não foi possível salvar a despesa. Tente novamente.');
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={expense ? 'Editar despesa' : 'Nova despesa'}
      subtitle={`Orçamento em ${trip.budgetCurrency}`}
    >
      <View style={{ gap: theme.spacing.lg }}>
        <Controller
          control={control}
          name="description"
          render={({ field, fieldState }) => (
            <TextField
              label="Descrição"
              placeholder="Ex.: Jantar no Marais"
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
              options={EXPENSE_CATEGORIES.map((category) => ({
                value: category,
                label: EXPENSE_CATEGORY_LABEL[category],
              }))}
              required
            />
          )}
        />

        <Controller
          control={control}
          name="currency"
          render={({ field, fieldState }) => (
            <SelectField
              label="Moeda paga"
              value={field.value}
              onChange={field.onChange}
              error={fieldState.error?.message}
              options={CURRENCIES.map((code) => ({ value: code, label: code }))}
              required
            />
          )}
        />

        <Controller
          control={control}
          name="amount"
          render={({ field, fieldState }) => (
            <MoneyField
              label="Valor"
              value={field.value}
              onChange={(value) => field.onChange(value ?? 0)}
              currency={chosenCurrency}
              error={fieldState.error?.message}
              required
            />
          )}
        />

        {needsConversion ? (
          rateUnavailable ? (
            <InlineNotice icon={TriangleAlert} tone="warning">
              Não temos cotação confiável para {chosenCurrency} → {trip.budgetCurrency}. A despesa
              será salva na moeda original e marcada como não convertida.
            </InlineNotice>
          ) : (
            <InlineNotice>
              A cotação {chosenCurrency} → {trip.budgetCurrency} será consultada e salva junto com a
              despesa, para que o valor histórico não mude quando o câmbio variar.
            </InlineNotice>
          )
        ) : null}

        <Controller
          control={control}
          name="transactionDate"
          render={({ field, fieldState }) => (
            <DateField
              label="Data"
              value={field.value}
              onChange={field.onChange}
              error={fieldState.error?.message}
              required
            />
          )}
        />

        <Button
          label={expense ? 'Salvar alterações' : 'Adicionar despesa'}
          size="lg"
          fullWidth
          loading={formState.isSubmitting}
          onPress={handleSubmit(onSubmit)}
          haptic
        />

        {expense ? (
          <Button
            label="Excluir despesa"
            variant="ghost"
            icon={Trash2}
            fullWidth
            onPress={() => onDelete(expense)}
          />
        ) : null}
      </View>
    </BottomSheet>
  );
}
