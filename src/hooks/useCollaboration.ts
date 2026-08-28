import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  canEditTrip,
  canLeaveTrip,
  canManageMembers,
  type InvitableRole,
  type TripRole,
} from '@/domain/collaboration';
import { useAuth } from '@/providers/AuthProvider';
import { useTripSelection } from '@/providers/TripSelectionProvider';
import { dataSource } from '@/repositories';
import { purgeRevokedTripState } from './useNotifications';
import { queryKeys } from './queryKeys';

/**
 * Quem participa da viagem, e o que quem está lendo pode fazer nela.
 *
 * A permissão vem de `trip_members`, não de `trip.userId`. A diferença aparece
 * exatamente no caso que este recurso existe para atender: uma viagem
 * compartilhada tem `userId` de outra pessoa, e comparar com a sessão daria
 * "não é seu" para alguém que é editor dela.
 *
 * Nada aqui é autorização. A RLS já recusa o que não pode; isto existe para a
 * tela não oferecer o que seria recusado (ver `src/domain/collaboration.ts`).
 */
export function useTripMembers(tripId?: string) {
  return useQuery({
    queryKey: queryKeys.tripMembers(tripId ?? 'none'),
    queryFn: () => dataSource.members.listMembers(tripId!),
    enabled: Boolean(tripId),
  });
}

export function useTripInvites(tripId?: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.tripInvites(tripId ?? 'none'),
    queryFn: () => dataSource.members.listInvites(tripId!),
    enabled: Boolean(tripId) && enabled,
  });
}

/**
 * O papel da sessão nesta viagem, com as permissões já resolvidas.
 *
 * `isLoading` importa: enquanto a resposta não chega, `canEdit` é `false`, e a
 * tela deve mostrar carregamento em vez de a versão somente-leitura. Piscar o
 * estado de `viewer` para quem é dono da viagem seria pior do que esperar.
 */
export function useTripPermissions(tripId?: string) {
  const { user } = useAuth();
  const membersQuery = useTripMembers(tripId);

  return useMemo(() => {
    const members = membersQuery.data ?? [];
    const mine = members.find((member) => member.userId === user?.id);
    const role: TripRole | undefined = mine?.role;
    // A refetch can fail while previously confirmed membership remains in the
    // cache. Keep that known permission; only an initial failure blocks the
    // role. Most importantly, an error is never converted to an empty member
    // list and then described as `viewer`.
    const blockingError = membersQuery.data === undefined ? membersQuery.error : null;
    const status = !tripId || !user?.id
      ? 'idle'
      : membersQuery.isLoading
        ? 'loading'
        : blockingError
          ? 'error'
          : role
            ? 'ready'
            : 'unavailable';

    return {
      role,
      members,
      memberCount: members.length,
      isShared: members.length > 1,
      canEdit: canEditTrip(role),
      canManageMembers: canManageMembers(role),
      canLeave: canLeaveTrip(role, members.length),
      status,
      isResolved: status === 'ready',
      isLoading: status === 'loading',
      isError: status === 'error',
      error: blockingError,
      refetch: membersQuery.refetch,
    };
  }, [membersQuery.data, membersQuery.error, membersQuery.isLoading, membersQuery.refetch, tripId, user?.id]);
}

/** Convites que a pessoa recebeu — alimenta o sino e a Central. */
export function useMyInvites() {
  const { user } = useAuth();
  return useQuery({
    queryKey: queryKeys.myInvites(user?.id ?? 'anonymous'),
    queryFn: () => dataSource.members.listPendingInvitesForUser(user!.id),
    enabled: Boolean(user?.id),
  });
}

export function useMembershipMutations(tripId: string) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { currentTripId, setCurrentTripId } = useTripSelection();

  /**
   * Toda mutação de membro invalida três coisas: a lista de membros, os
   * convites e a lista de viagens.
   *
   * A terceira é a que se esquece. Aceitar um convite faz uma viagem nova
   * aparecer em "Minhas viagens"; sair faz uma desaparecer. Sem invalidar
   * `trips`, a Home continuaria mostrando o estado anterior até o próximo
   * `refetch` — e o usuário concluiria que sair não funcionou (§59).
   */
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.tripMembers(tripId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.tripMemberNames(tripId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.tripInvites(tripId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.trips(user?.id ?? 'anonymous') }),
    ]);
  };

  const invite = useMutation({
    mutationFn: ({ email, role }: { email: string; role: InvitableRole }) =>
      dataSource.members.invite(tripId, email, role),
    onSuccess: invalidate,
  });

  const setRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: InvitableRole }) =>
      dataSource.members.setRole(tripId, userId, role),
    onSuccess: invalidate,
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) => dataSource.members.removeMember(tripId, userId),
    onSuccess: invalidate,
  });

  /**
   * Transferir a propriedade (§50).
   *
   * A invalidação aqui é mais larga que a das outras mutações de membro, e por
   * um motivo concreto: quem transfere PERDE permissões na mesma ação. A tela
   * que ficou aberta continuaria oferecendo "Convidar", "Remover" e
   * "Transferir" até o próximo `refetch`, e cada um desses toques viraria um
   * erro vindo do servidor — que já recusaria, mas depois de a pessoa ter
   * tocado.
   *
   * `invalidate` cobre membros, convites e a lista de viagens. Falta a viagem
   * em si: `trips.user_id` mudou, e é dela que sai o que a tela de detalhe
   * mostra sobre propriedade.
   */
  const transferOwnership = useMutation({
    mutationFn: (userId: string) => dataSource.members.transferOwnership(tripId, userId),
    onSuccess: async () => {
      await Promise.all([
        invalidate(),
        queryClient.invalidateQueries({ queryKey: queryKeys.trip(tripId) }),
      ]);
    },
  });

  const cancelInvite = useMutation({
    mutationFn: (inviteId: string) => dataSource.members.cancelInvite(inviteId),
    onSuccess: invalidate,
  });

  /**
   * Sair da viagem.
   *
   * A limpeza NÃO depende da notificação. `leave_trip` remove a própria linha
   * de `trip_members`, e a notificação `trip_member_removed` é escrita para
   * quem REMOVE alguém — sair por conta própria não produz necessariamente um
   * evento para quem saiu. Esperar por ele deixaria o roteiro, as reservas e as
   * cópias locais de arquivo no aparelho de quem já não é membro (§15).
   *
   * O expurgo é o mesmo da revogação confirmada, e roda apenas em `onSuccess`:
   * se a saída falhar, a pessoa continua membro e nada é apagado (§16).
   */
  const leave = useMutation({
    mutationFn: () => dataSource.members.leave(tripId),
    onSuccess: async () => {
      if (user?.id) {
        purgeRevokedTripState(queryClient, user.id, [tripId], {
          currentTripId,
          clear: () => setCurrentTripId(null),
        });
      }
      await invalidate();
    },
  });

  return { invite, setRole, removeMember, transferOwnership, cancelInvite, leave };
}

/**
 * Responder a um convite. Fica separado de `useMembershipMutations` porque quem
 * responde não conhece a viagem ainda — o convite chega pelo sino, e não pela
 * tela da viagem, que a pessoa sequer consegue abrir antes de aceitar.
 */
export function useInviteResponse() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.myInvites(user?.id ?? 'anonymous') }),
      queryClient.invalidateQueries({ queryKey: queryKeys.trips(user?.id ?? 'anonymous') }),
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications(user?.id ?? 'anonymous') }),
    ]);
  };

  const accept = useMutation({
    mutationFn: (inviteId: string) => dataSource.members.acceptInvite(inviteId),
    onSuccess: invalidate,
  });

  const decline = useMutation({
    mutationFn: (inviteId: string) => dataSource.members.declineInvite(inviteId),
    onSuccess: invalidate,
  });

  return { accept, decline };
}

/**
 * Nome de autores/pagadores por id — para "Adicionado/Pago por Maria".
 *
 * É uma consulta separada da lista ativa: o mapa pode conter uma pessoa que
 * saiu mas deixou conteúdo compartilhado, sem fazê-la reaparecer em
 * "Viajantes". O RPC devolve apenas id e nome (§9, §52).
 */
export function useMemberNames(tripId?: string): Record<string, string> {
  const { data } = useQuery({
    queryKey: queryKeys.tripMemberNames(tripId ?? 'none'),
    queryFn: () => dataSource.members.memberNames(tripId!),
    enabled: Boolean(tripId),
  });
  return data ?? {};
}
