import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  ChecklistItem,
  Expense,
  ItineraryItem,
  JournalEntry,
  Ticket,
  Trip,
} from '@/domain/types';
import { useAuth } from '@/providers/AuthProvider';
import { dataSource, type UploadableFile } from '@/repositories';
import { currencyService } from '@/services/currency';
import { buildExpenseRecord, type ExpenseDraft } from '@/services/expenseWrite';
import { queryKeys } from './queryKeys';

/* -------------------------------- itinerary ------------------------------- */

export function useItinerary(tripId?: string) {
  return useQuery({
    queryKey: queryKeys.itinerary(tripId ?? 'none'),
    queryFn: () => dataSource.itinerary.listByTrip(tripId!),
    enabled: Boolean(tripId),
  });
}

export function useItineraryMutations(tripId: string) {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.itinerary(tripId) });

  const create = useMutation({
    mutationFn: (input: Omit<ItineraryItem, 'id' | 'tripId'>) =>
      dataSource.itinerary.create({ ...input, tripId }),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<ItineraryItem> }) =>
      dataSource.itinerary.update(id, patch),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => dataSource.itinerary.remove(id),
    onSuccess: invalidate,
  });

  return { create, update, remove };
}

/* -------------------------------- checklist ------------------------------- */

export function useChecklist(tripId?: string) {
  return useQuery({
    queryKey: queryKeys.checklist(tripId ?? 'none'),
    queryFn: () => dataSource.checklist.listByTrip(tripId!),
    enabled: Boolean(tripId),
  });
}

export function useChecklistMutations(tripId: string) {
  const queryClient = useQueryClient();
  const key = queryKeys.checklist(tripId);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: key });

  const create = useMutation({
    mutationFn: (input: Omit<ChecklistItem, 'id' | 'tripId' | 'createdAt'>) =>
      dataSource.checklist.create({ ...input, tripId }),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<ChecklistItem> }) =>
      dataSource.checklist.update(id, patch),
    // Toggling a checkbox must feel instant, so the cache flips before the
    // write completes and rolls back if it fails.
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ChecklistItem[]>(key);
      queryClient.setQueryData<ChecklistItem[]>(key, (items) =>
        (items ?? []).map((item) => (item.id === id ? { ...item, ...patch } : item)),
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => dataSource.checklist.remove(id),
    onSuccess: invalidate,
  });

  return { create, update, remove };
}

/* --------------------------------- expenses -------------------------------- */

export function useExpenses(tripId?: string) {
  return useQuery({
    queryKey: queryKeys.expenses(tripId ?? 'none'),
    queryFn: () => dataSource.expenses.listByTrip(tripId!),
    enabled: Boolean(tripId),
  });
}

export type { ExpenseDraft } from '@/services/expenseWrite';

/**
 * Creating an expense also resolves and *stores* the exchange rate used (§41).
 * If no trustworthy rate exists the expense is saved unconverted and the UI
 * flags it — we never fabricate a rate to make the totals look tidy.
 *
 * A montagem do registro vive em `buildExpenseRecord`, e não aqui, porque uma
 * despesa também pode nascer de uma proposta aceita da IA. As duas passam pela
 * mesma função de propósito: se a regra de câmbio existisse em duas cópias, a
 * primeira correção deixaria uma delas para trás — e as duas continuariam
 * gravando, cada uma do seu jeito.
 */
export function useExpenseMutations(trip: Trip) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.expenses(trip.id) });

  const create = useMutation({
    mutationFn: async (draft: ExpenseDraft) =>
      dataSource.expenses.create(await buildExpenseRecord(trip, user!.id, draft)),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Expense> }) => {
      // Re-price only when the amount or currency actually changed.
      if (patch.amount !== undefined || patch.currency !== undefined) {
        const currency = patch.currency ?? trip.budgetCurrency;
        const amount = patch.amount ?? 0;
        if (currency !== trip.budgetCurrency) {
          const conversion = await currencyService.convert(amount, currency, trip.budgetCurrency);
          return dataSource.expenses.update(id, {
            ...patch,
            amountInBudgetCurrency: conversion?.value,
            exchangeRate: conversion?.rate.rate,
            exchangeRateTimestamp: conversion?.rate.timestamp,
          });
        }
        return dataSource.expenses.update(id, {
          ...patch,
          amountInBudgetCurrency: amount,
          exchangeRate: undefined,
          exchangeRateTimestamp: undefined,
        });
      }
      return dataSource.expenses.update(id, patch);
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => dataSource.expenses.remove(id),
    onSuccess: invalidate,
  });

  return { create, update, remove };
}

/* --------------------------------- tickets -------------------------------- */

export function useTickets(tripId?: string) {
  return useQuery({
    queryKey: queryKeys.tickets(tripId ?? 'none'),
    queryFn: () => dataSource.tickets.listByTrip(tripId!),
    enabled: Boolean(tripId),
  });
}

export function useTicketMutations(tripId: string) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.tickets(tripId) });

  const create = useMutation({
    mutationFn: async ({
      input,
      file,
    }: {
      input: Omit<Ticket, 'id' | 'tripId' | 'userId' | 'fileUrl' | 'mimeType'>;
      file?: UploadableFile;
    }) => {
      const stored = file
        ? await dataSource.tickets.uploadAttachment(user!.id, tripId, file)
        : undefined;
      return dataSource.tickets.create({
        ...input,
        tripId,
        userId: user!.id,
        fileUrl: stored?.url,
        mimeType: stored?.mimeType,
      });
    },
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: async ({
      id,
      patch,
      file,
    }: {
      id: string;
      patch: Partial<Ticket>;
      file?: UploadableFile;
    }) => {
      const stored = file
        ? await dataSource.tickets.uploadAttachment(user!.id, tripId, file)
        : undefined;
      return dataSource.tickets.update(id, {
        ...patch,
        ...(stored ? { fileUrl: stored.url, mimeType: stored.mimeType } : {}),
      });
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => dataSource.tickets.remove(id),
    onSuccess: invalidate,
  });

  return { create, update, remove };
}

/* --------------------------------- journal -------------------------------- */

export function useJournal(tripId?: string) {
  return useQuery({
    queryKey: queryKeys.journal(tripId ?? 'none'),
    queryFn: () => dataSource.journal.listByTrip(tripId!),
    enabled: Boolean(tripId),
  });
}

export function useJournalMedia(tripId: string | undefined, entryIds: string[]) {
  return useQuery({
    queryKey: [...queryKeys.journalMedia(tripId ?? 'none'), entryIds.length],
    queryFn: () => dataSource.journal.listMedia(entryIds),
    enabled: Boolean(tripId) && entryIds.length > 0,
  });
}

export function useJournalMutations(tripId: string) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.journal(tripId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.journalMedia(tripId) }),
    ]);
  };

  const create = useMutation({
    mutationFn: async ({
      input,
      files,
    }: {
      input: Omit<JournalEntry, 'id' | 'tripId' | 'userId' | 'createdAt' | 'updatedAt'>;
      files?: UploadableFile[];
    }) => {
      const entry = await dataSource.journal.create({ ...input, tripId, userId: user!.id });
      for (const file of files ?? []) {
        await dataSource.journal.addMedia(entry.id, user!.id, file);
      }
      return entry;
    },
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: async ({
      id,
      patch,
      files,
    }: {
      id: string;
      patch: Partial<JournalEntry>;
      files?: UploadableFile[];
    }) => {
      const entry = await dataSource.journal.update(id, patch);
      for (const file of files ?? []) {
        await dataSource.journal.addMedia(id, user!.id, file);
      }
      return entry;
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => dataSource.journal.remove(id),
    onSuccess: invalidate,
  });

  const removeMedia = useMutation({
    mutationFn: (mediaId: string) => dataSource.journal.removeMedia(mediaId),
    onSuccess: invalidate,
  });

  return { create, update, remove, removeMedia };
}
