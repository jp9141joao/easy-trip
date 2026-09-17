import { Target, TriangleAlert } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import {
  AppText,
  Button,
  ButtonRow,
  ConfirmDialog,
  GlassCard,
  InlineNotice,
  MoneyField,
  ProgressBar,
  SectionHeader,
  useToast,
} from '@/components/ui';
import { getDailyGoalStatus, getDailySpend } from '@/domain/selectors';
import type { Expense, Trip } from '@/domain/types';
import { useUpdateTrip } from '@/hooks/useTrips';
import { describeBackendCapability } from '@/repositories/backendCapabilities';
import { formatWeekdayDate, todayISO } from '@/lib/date';
import { formatMoney } from '@/lib/currency';
import { useTheme } from '@/theme';

/**
 * Meta de gasto diário (§27–§34 do handoff).
 *
 * A META É DA VIAGEM (§28)
 *
 * Mora em `trips.daily_spending_goal`, ao lado do orçamento total, e não numa
 * configuração de conta. Tóquio a 500/dia e São Paulo a 250/dia são a mesma
 * pessoa com duas viagens — uma preferência global não teria como dizer isso.
 *
 * A MOEDA É A DO ORÇAMENTO (§29)
 *
 * `trip.budgetCurrency`, sem escolha própria e sem conversão paralela. É a
 * moeda em que o cartão de saldo logo acima está escrito e em que
 * `getDailySpend` soma — dar à meta uma moeda própria criaria dois números na
 * mesma tela que não se comparam, e comparar é a única coisa que a meta faz.
 *
 * QUEM PODE DEFINIR
 *
 * Quem pode editar as demais propriedades da viagem: o proprietário. É a mesma
 * autorização de `budgetTotal`, decidida pelo chamador e não aqui — orçamento e
 * meta são o mesmo tipo de decisão, e teria sido estranho que um editor
 * mudasse o teto diário sem poder mudar o total. Todo membro VÊ a meta e o
 * quanto já se gastou: é informação da viagem, não configuração privada.
 */
export function DailyGoalCard({
  trip,
  expenses,
  canEdit,
}: {
  trip: Trip;
  expenses: Expense[];
  canEdit: boolean;
}) {
  const theme = useTheme();
  const toast = useToast();
  const updateTrip = useUpdateTrip();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<number | undefined>(trip.dailySpendingGoal);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const today = todayISO();
  const status = useMemo(
    () => getDailyGoalStatus(expenses, trip, today),
    [expenses, trip, today],
  );

  /*
   * Os dias da viagem que TIVERAM gasto (§33).
   *
   * Não é a grade de todas as datas entre ida e volta: um dia sem despesa não
   * tem o que mostrar, e enfileirar "0 / 300" para as duas semanas que ainda
   * não aconteceram encheria a tela de linhas vazias. Do mais recente para o
   * mais antigo, porque é o de hoje que interessa primeiro.
   */
  const dias = useMemo(
    () => getDailySpend(expenses, trip).slice().reverse().slice(0, 7),
    [expenses, trip],
  );

  const salvar = async () => {
    // Campo vazio não é meta de zero — é desistência. Quem quer remover usa o
    // botão de remover, que confirma; salvar vazio simplesmente não faz nada.
    if (draft === undefined || draft <= 0) {
      toast.warning('Informe um valor maior que zero para a meta diária.');
      return;
    }
    try {
      await updateTrip.mutateAsync({ tripId: trip.id, patch: { dailySpendingGoal: draft } });
      setEditing(false);
      toast.success('Meta diária salva');
    } catch (error) {
      toast.error(describeBackendCapability(error) ?? 'Não foi possível salvar a meta diária.');
    }
  };

  const remover = async () => {
    try {
      await updateTrip.mutateAsync({ tripId: trip.id, patch: { dailySpendingGoal: undefined } });
      setConfirmRemove(false);
      setEditing(false);
      setDraft(undefined);
      toast.success('Meta diária removida');
    } catch (error) {
      toast.error(describeBackendCapability(error) ?? 'Não foi possível remover a meta diária.');
    }
  };

  const semMeta = status.goal === undefined;

  return (
    <GlassCard>
      <SectionHeader title="Meta diária" />

      <View style={{ gap: theme.spacing.md }}>
        {editing ? (
          <View style={{ gap: theme.spacing.md }}>
            <MoneyField
              label={`Meta por dia (${trip.budgetCurrency})`}
              value={draft}
              onChange={setDraft}
              currency={trip.budgetCurrency}
            />
            <ButtonRow>
              <Button
                label="Cancelar"
                variant="secondary"
                onPress={() => {
                  setDraft(trip.dailySpendingGoal);
                  setEditing(false);
                }}
              />
              <Button label="Salvar" loading={updateTrip.isPending} onPress={() => void salvar()} />
            </ButtonRow>
          </View>
        ) : semMeta ? (
          <View style={{ gap: theme.spacing.md }}>
            <AppText variant="bodySmall" color="secondary">
              Defina quanto pretende gastar por dia nesta viagem. O Easy Trip avisa quando o dia
              passar do limite.
            </AppText>
            {canEdit ? (
              <Button
                label="Definir meta diária"
                variant="secondary"
                icon={Target}
                fullWidth
                onPress={() => {
                  setDraft(trip.dailySpendingGoal);
                  setEditing(true);
                }}
              />
            ) : null}
          </View>
        ) : (
          <View style={{ gap: theme.spacing.md }}>
            {/*
              O número primeiro, em uma frase que se lê sozinha: "R$ 220 de
              R$ 300". A barra ilustra; ela não é a informação (§32).
            */}
            <View style={{ gap: 2 }}>
              <AppText variant="caption" color="secondary" uppercase>
                Hoje · {formatWeekdayDate(today)}
              </AppText>
              <AppText variant="h3" mono weight="bold" adjustsFontSizeToFit numberOfLines={1}>
                {`${formatMoney(status.spent, trip.budgetCurrency)} de ${formatMoney(status.goal ?? 0, trip.budgetCurrency)}`}
              </AppText>
            </View>

            <ProgressBar
              percent={goalPercent(status.spent, status.goal ?? 0)}
              tone={status.exceeded ? 'error' : goalPercent(status.spent, status.goal ?? 0) > 80 ? 'warning' : 'brand'}
              height={10}
              label="Uso da meta diária"
            />

            {/*
              O ESTADO NÃO É COMUNICADO SÓ POR COR (§47).

              A barra fica vermelha quando estoura, mas quem não distingue a cor
              — ou está no sol, com o brilho no mínimo — lê a mesma coisa em
              texto. É por isso que esta linha existe mesmo com a barra logo
              acima dizendo "o mesmo".
            */}
            {status.exceeded ? (
              <InlineNotice icon={TriangleAlert} tone="error">
                {`Meta ultrapassada: ${formatMoney(status.over, trip.budgetCurrency)} acima do limite de hoje.`}
              </InlineNotice>
            ) : (
              <AppText variant="bodySmall" color="secondary">
                {`Dentro da meta · ${formatMoney(status.remaining ?? 0, trip.budgetCurrency)} disponíveis hoje.`}
              </AppText>
            )}

            {dias.length > 0 ? (
              <View style={{ gap: theme.spacing.sm }}>
                <AppText variant="label" color="secondary">
                  Últimos dias
                </AppText>
                {dias.map((dia) => {
                  const doDia = getDailyGoalStatus(expenses, trip, dia.date);
                  return (
                    <View
                      key={dia.date}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: theme.spacing.sm,
                      }}
                      accessibilityLabel={
                        `${formatWeekdayDate(dia.date)}: ` +
                        `${formatMoney(dia.spent, trip.budgetCurrency)} de ` +
                        `${formatMoney(status.goal ?? 0, trip.budgetCurrency)}. ` +
                        `${doDia.exceeded ? 'Meta ultrapassada' : 'Dentro da meta'}.`
                      }
                    >
                      <AppText variant="bodySmall" color="secondary" numberOfLines={1} style={{ flex: 1 }}>
                        {formatWeekdayDate(dia.date)}
                      </AppText>
                      <AppText
                        variant="bodySmall"
                        mono
                        weight="semibold"
                        color={doDia.exceeded ? 'error' : 'primary'}
                      >
                        {`${formatMoney(dia.spent, trip.budgetCurrency)} / ${formatMoney(status.goal ?? 0, trip.budgetCurrency)}`}
                      </AppText>
                    </View>
                  );
                })}
              </View>
            ) : null}

            {canEdit ? (
              <ButtonRow>
                <Button
                  label="Remover"
                  variant="secondary"
                  onPress={() => setConfirmRemove(true)}
                />
                <Button
                  label="Editar meta"
                  onPress={() => {
                    setDraft(trip.dailySpendingGoal);
                    setEditing(true);
                  }}
                />
              </ButtonRow>
            ) : null}
          </View>
        )}
      </View>

      <ConfirmDialog
        visible={confirmRemove}
        title="Remover meta diária?"
        message="A Carteira volta a mostrar só o orçamento total desta viagem. As despesas não são alteradas."
        confirmLabel="Remover"
        destructive
        loading={updateTrip.isPending}
        onConfirm={() => void remover()}
        onCancel={() => setConfirmRemove(false)}
      />
    </GlassCard>
  );
}

/** Percentual para a barra. Passa de 100 quando estoura — quem achata é a barra. */
function goalPercent(spent: number, goal: number): number {
  if (goal <= 0) return 0;
  return (spent / goal) * 100;
}
