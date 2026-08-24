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
import { dataSource } from '@/repositories';
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

    return {
      role,
      members,
      memberCount: members.length,
      isShared: members.length > 1,
      canEdit: canEditTrip(role),
      canManageMembers: canManageMembers(role),
      canLeave: canLeaveTrip(role, members.length),
      isLoading: membersQuery.isLoading,
    };
  }, [membersQuery.data, membersQuery.isLoading, user?.id]);
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

  const cancelInvite = useMutation({
    mutationFn: (inviteId: string) => dataSource.members.cancelInvite(inviteId),
    onSuccess: invalidate,
  });

  const leave = useMutation({
    mutationFn: () => dataSource.members.leave(tripId),
    onSuccess: invalidate,
  });

  return { invite, setRole, removeMember, cancelInvite, leave };
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

/** Nome de cada membro por id — para "Adicionado por Maria" (§9, §52). */
export function useMemberNames(tripId?: string): Record<string, string> {
  const { data: members = [] } = useTripMembers(tripId);
  return useMemo(
    () =>
      Object.fromEntries(
        members.filter((member) => member.name).map((member) => [member.userId, member.name!]),
      ),
    [members],
  );
}
