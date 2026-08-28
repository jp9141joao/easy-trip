import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Goal } from '@/domain/types';
import { getGoalProgress } from '@/domain/selectors';
import { useAuth } from '@/providers/AuthProvider';
import { dataSource } from '@/repositories';
import { newRowId, useOfflineFallback } from './useOfflineFallback';
import { queryKeys } from './queryKeys';

export function useGoals() {
  const { user } = useAuth();
  return useQuery({
    queryKey: queryKeys.goals(user?.id ?? 'anonymous'),
    queryFn: () => dataSource.goals.list(user!.id),
    enabled: Boolean(user),
  });
}

export function useGoalMutations() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.goals(user!.id) });

  // Metas não pertencem a uma viagem — daí o `tripId` ausente (§33).
  const offline = useOfflineFallback('goal');

  const create = useMutation({
    mutationFn: (input: Omit<Goal, 'id' | 'userId' | 'createdAt' | 'updatedAt' | 'status'>) => {
      const id = newRowId();
      const row = { ...input, id, userId: user!.id, status: 'active' as const };
      return offline({
        operation: 'create',
        targetId: id,
        payload: { ...input, userId: user!.id, status: 'active' },
        direct: () => dataSource.goals.create(row),
        optimistic: row as Goal,
      });
    },
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Goal> }) =>
      offline({
        operation: 'update',
        targetId: id,
        payload: patch as Record<string, unknown>,
        direct: () => dataSource.goals.update(id, patch),
        optimistic: { id, ...patch } as Goal,
      }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      offline({
        operation: 'remove',
        targetId: id,
        payload: {},
        direct: () => dataSource.goals.remove(id),
        optimistic: undefined,
      }),
    onSuccess: invalidate,
  });

  /**
   * Adds progress to a goal and completes it automatically once the target is
   * reached (§43) — the status is a consequence of the numbers, not a field the
   * user has to remember to flip.
   */
  const addProgress = useMutation({
    mutationFn: ({ goal, amount }: { goal: Goal; amount: number }) => {
      const currentValue = Math.max(0, goal.currentValue + amount);
      const reached = getGoalProgress({ ...goal, currentValue }).reached;
      return dataSource.goals.update(goal.id, {
        currentValue,
        status: reached ? 'completed' : goal.status === 'completed' ? 'active' : goal.status,
      });
    },
    onSuccess: invalidate,
  });

  return { create, update, remove, addProgress };
}
