import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Goal } from '@/domain/types';
import { getGoalProgress } from '@/domain/selectors';
import { useAuth } from '@/providers/AuthProvider';
import { dataSource } from '@/repositories';
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

  const create = useMutation({
    mutationFn: (input: Omit<Goal, 'id' | 'userId' | 'createdAt' | 'updatedAt' | 'status'>) =>
      dataSource.goals.create({ ...input, userId: user!.id, status: 'active' }),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Goal> }) =>
      dataSource.goals.update(id, patch),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => dataSource.goals.remove(id),
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
