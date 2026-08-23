/**
 * Como uma despesa vira registro — em um lugar só.
 *
 * A conversão de moeda da §41 (converter com cotação real, guardar a taxa e o
 * horário junto, e gravar sem conversão quando não há cotação confiável) existia
 * apenas dentro de `useExpenseMutations`. Quando a IA passou a poder propor
 * despesas, havia dois caminhos possíveis: repetir a regra no executor, ou
 * extraí-la. Repetida, as duas cópias divergiriam no primeiro ajuste — e a
 * divergência seria silenciosa, porque as duas continuariam gravando.
 *
 * Uma despesa criada pela tela e uma despesa criada a partir de uma proposta da
 * IA passam por esta mesma função, e por isso são o mesmo tipo de registro.
 */

import type { CurrencyCode, Expense, ExpenseCategory, ISODate, Trip } from '@/domain/types';
import { nowISO } from '@/lib/date';
import { currencyService } from './currency';

export interface ExpenseDraft {
  description: string;
  category: ExpenseCategory;
  amount: number;
  currency: CurrencyCode;
  transactionDate: ISODate;
}

/**
 * Monta o registro pronto para `expenses.create`, resolvendo a cotação quando
 * a moeda paga difere a do orçamento.
 *
 * Sem cotação confiável, `amountInBudgetCurrency` fica ausente — a despesa é
 * gravada como foi paga e a tela sinaliza que ela não entra na soma. Nunca se
 * inventa uma taxa para o total fechar bonito.
 */
export async function buildExpenseRecord(
  trip: Trip,
  userId: string,
  draft: ExpenseDraft,
): Promise<Omit<Expense, 'id' | 'createdAt'>> {
  const sameCurrency = draft.currency === trip.budgetCurrency;
  const conversion = sameCurrency
    ? null
    : await currencyService.convert(draft.amount, draft.currency, trip.budgetCurrency);

  return {
    tripId: trip.id,
    userId,
    description: draft.description,
    category: draft.category,
    amount: draft.amount,
    currency: draft.currency,
    amountInBudgetCurrency: sameCurrency ? draft.amount : conversion?.value,
    exchangeRate: conversion?.rate.rate,
    exchangeRateTimestamp: conversion?.rate.timestamp ?? (conversion ? nowISO() : undefined),
    transactionDate: draft.transactionDate,
  };
}
