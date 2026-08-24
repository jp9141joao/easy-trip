/**
 * A execução de uma proposta, do ponto de vista da tela.
 *
 * O `aiActionExecutor` sabe gravar; este hook sabe *quando* deixar gravar e o
 * que fazer depois. São responsabilidades diferentes e ficam separadas de
 * propósito: o executor é testável sem React, e esta camada é onde vivem as
 * três coisas que só existem porque há uma interface por perto —
 *
 *   1. **um toque de cada vez**: enquanto uma proposta está sendo aplicada,
 *      nenhuma outra começa, e a mesma não recomeça (§10, §32);
 *   2. **offline não finge**: sem rede a gravação nem é tentada, e a proposta
 *      continua na tela para ser aplicada depois. O projeto decidiu não ter
 *      fila offline de mutações — então o honesto é dizer que não deu (§32);
 *   3. **as telas reagem**: roteiro, checklist, gastos, orçamento e metas são
 *      invalidados depois da gravação, então abrir a aba Roteiro logo em
 *      seguida mostra os itens novos, não o cache anterior.
 */

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import type { AITripAction } from '@/domain/aiActions';
import type { Trip } from '@/domain/types';
import { useAuth } from '@/providers/AuthProvider';
import { useConnectivity } from '@/providers/ConnectivityProvider';
import {
  executeAIActions,
  undoAIActions,
  type AIActionContext,
  type AIActionReport,
} from '@/services/aiActionExecutor';
import { queryKeys } from './queryKeys';

export class AIActionBlockedError extends Error {}

export function useAIActionRunner(trip: Trip | null) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { isOffline } = useConnectivity();

  /** Chave da proposta em execução — normalmente o id da mensagem. */
  const [runningKey, setRunningKey] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);

  const invalidate = useCallback(async () => {
    if (!trip || !user) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.itinerary(trip.id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.checklist(trip.id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.expenses(trip.id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.trip(trip.id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.trips(user.id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.goals(user.id) }),
    ]);
  }, [queryClient, trip, user]);

  const run = useCallback(
    async (
      key: string,
      actions: AITripAction[],
      visibility?: AIActionContext['visibility'],
    ): Promise<AIActionReport> => {
      if (!trip || !user) {
        throw new AIActionBlockedError('Selecione uma viagem antes de aplicar a sugestão.');
      }
      // O bloqueio do toque duplo é aqui, e não só no `disabled` do botão: um
      // segundo toque que chegue no mesmo frame não vê o estado atualizado.
      if (runningKey) {
        throw new AIActionBlockedError('Já existe uma sugestão sendo aplicada.');
      }
      if (isOffline) {
        throw new AIActionBlockedError(
          'Você está sem conexão. A sugestão continua aqui para aplicar quando a rede voltar.',
        );
      }

      setRunningKey(key);
      try {
        const report = await executeAIActions(actions, { trip, userId: user.id, visibility });
        await invalidate();
        return report;
      } finally {
        setRunningKey(null);
      }
    },
    [invalidate, isOffline, runningKey, trip, user],
  );

  const undo = useCallback(
    async (report: AIActionReport) => {
      if (!trip || !user) return { removed: 0, failed: 0 };
      setUndoing(true);
      try {
        const result = await undoAIActions(report, { trip, userId: user.id });
        await invalidate();
        return result;
      } finally {
        setUndoing(false);
      }
    },
    [invalidate, trip, user],
  );

  return {
    run,
    undo,
    runningKey,
    undoing,
    isBusy: runningKey !== null || undoing,
  };
}
