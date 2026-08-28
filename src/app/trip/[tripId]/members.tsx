import { useRouter } from 'expo-router';
import { Clock3, Crown, LogOut, UserPlus, Users, X } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { InviteSheet, MemberRow } from '@/components/collaboration';
import {
  AppHeader,
  AppText,
  BottomSheet,
  Button,
  ConfirmDialog,
  Divider,
  EmptyState,
  ErrorState,
  GlassCard,
  InlineNotice,
  SkeletonList,
  useToast,
} from '@/components/ui';
import { AuroraBackground } from '@/components/ui/Surface';
import {
  ROLE_LABEL,
  canTransferOwnership,
  memberDisplayName,
  transferCandidates,
  transferWarning,
  type InvitableRole,
  type TripMember,
} from '@/domain/collaboration';
import { useTripRoute } from '@/features/trip/useTripRoute';
import {
  useMembershipMutations,
  useTripInvites,
  useTripPermissions,
} from '@/hooks/useCollaboration';
import { useAuth } from '@/providers/AuthProvider';
import { dataSource } from '@/repositories';
import { describeBackendCapability } from '@/repositories/backendCapabilities';
import { DemoUnavailableError } from '@/repositories/local/collaboration';
import { useTheme } from '@/theme';

/**
 * Viajantes da viagem (§49, §50).
 *
 * A tela existe nos dois modos de operação, e é isso que a mantém honesta: no
 * modo demonstração ela mostra "Você · Proprietário" e explica que convidar
 * exige conexão, em vez de esconder o recurso ou — pior — oferecer um botão
 * que finge ter enviado um convite (§68).
 */
export default function MembersScreen() {
  const theme = useTheme();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const { tripId, trip, isLoading, isError, notFound, errorMessage, refetch } = useTripRoute();
  const permissions = useTripPermissions(tripId);
  const invitesQuery = useTripInvites(tripId, permissions.canManageMembers);
  const invites = invitesQuery.data ?? [];
  const mutations = useMembershipMutations(tripId);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [managing, setManaging] = useState<TripMember | null>(null);
  const [removing, setRemoving] = useState<TripMember | null>(null);
  const [leaving, setLeaving] = useState(false);
  // Dois estados, e não um: escolher para quem transferir é uma tela, confirmar
  // é outra. Fundir as duas faria a lista de pessoas ser ela própria a
  // confirmação — um toque errado transferiria a viagem (§50).
  const [transferPicker, setTransferPicker] = useState(false);
  const [transferTarget, setTransferTarget] = useState<TripMember | null>(null);

  const demoMode = dataSource.kind === 'local';
  const candidates = transferCandidates(permissions.members, user?.id);
  const canTransfer = !demoMode && canTransferOwnership(permissions.role, candidates.length);

  const permissionsUnavailable =
    permissions.status === 'error' || permissions.status === 'unavailable';
  const invitesUnavailable = permissions.canManageMembers && invitesQuery.isError;

  if (isLoading || isError || notFound || !trip || permissionsUnavailable || invitesUnavailable) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background, padding: theme.spacing.screen, paddingTop: 100 }}>
        {isLoading ? (
          <SkeletonList count={3} lines={2} />
        ) : (
          <GlassCard>
            <ErrorState
              title={
                notFound
                  ? 'Viagem não encontrada'
                  : permissionsUnavailable || invitesUnavailable
                    ? 'Colaboração indisponível'
                    : 'Não foi possível carregar'
              }
              message={
                notFound
                  ? 'Esta viagem pode ter sido excluída.'
                  : permissionsUnavailable
                    ? describeBackendCapability(permissions.error) ??
                      'Não foi possível confirmar sua participação nesta viagem.'
                    : invitesUnavailable
                      ? describeBackendCapability(invitesQuery.error) ??
                        'Não foi possível carregar os convites desta viagem.'
                    : errorMessage
              }
              onRetry={
                notFound
                  ? () => router.replace('/(tabs)/trips')
                  : () => {
                      void refetch();
                      void permissions.refetch();
                      void invitesQuery.refetch();
                    }
              }
            />
          </GlassCard>
        )}
      </View>
    );
  }

  const handleInvite = async (email: string, role: InvitableRole) => {
    try {
      await mutations.invite.mutateAsync({ email, role });
    } catch (error) {
      // O modo demonstração tem um erro próprio, e a mensagem dele diz o que
      // fazer. Repassá-lo como "não foi possível convidar" esconderia que o
      // recurso existe e só precisa de conexão.
      if (error instanceof DemoUnavailableError) {
        throw new Error('Convidar viajantes exige conexão com o Easy Trip.');
      }
      throw new Error(memberActionError(error, 'Não foi possível convidar.'));
    }
  };

  const handleRoleChange = async (member: TripMember, role: InvitableRole) => {
    try {
      await mutations.setRole.mutateAsync({ userId: member.userId, role });
      toast.success(`Permissão alterada para "${ROLE_LABEL[role]}"`);
      setManaging(null);
    } catch (error) {
      toast.error(memberActionError(error, 'Não foi possível alterar a permissão.'));
    }
  };

  const handleRemove = async () => {
    if (!removing) return;
    try {
      await mutations.removeMember.mutateAsync(removing.userId);
      toast.success(`${memberDisplayName(removing, user?.id)} saiu da viagem`);
      setRemoving(null);
    } catch (error) {
      toast.error(memberActionError(error, 'Não foi possível remover.'));
    }
  };

  const handleLeave = async () => {
    try {
      await mutations.leave.mutateAsync();
      setLeaving(false);
      toast.success('Você saiu da viagem');
      router.replace('/(tabs)/trips');
    } catch (error) {
      setLeaving(false);
      toast.error(memberActionError(error, 'Não foi possível sair da viagem.'));
    }
  };

  const handleTransfer = async () => {
    if (!transferTarget) return;
    const name = memberDisplayName(transferTarget, user?.id);
    try {
      await mutations.transferOwnership.mutateAsync(transferTarget.userId);
      setTransferTarget(null);
      toast.success(`${name} agora é proprietário desta viagem`);
    } catch (error) {
      // O alvo continua na tela: a pessoa erra a escolha, corrige e tenta de
      // novo sem reabrir a lista. Fechar tudo em caso de erro obrigaria a
      // refazer o caminho inteiro por uma falha que pode ser de rede.
      toast.error(memberActionError(error, 'Não foi possível transferir a propriedade.'));
    }
  };

  const handleCancelInvite = async (inviteId: string) => {
    try {
      await mutations.cancelInvite.mutateAsync(inviteId);
      toast.success('Convite cancelado');
    } catch (error) {
      toast.error(memberActionError(error, 'Não foi possível cancelar o convite.'));
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AuroraBackground />

      <View style={{ paddingHorizontal: theme.spacing.screen }}>
        <AppHeader
          label={trip.destinationCity}
          title="Viajantes"
          subtitle={
            permissions.isLoading
              ? 'Carregando viajantes…'
              : permissions.memberCount === 1
              ? 'Só você nesta viagem'
              : `${permissions.memberCount} pessoas nesta viagem`
          }
          showBack
        />
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.screen,
          paddingBottom: insets.bottom + theme.spacing['3xl'],
          gap: theme.spacing.lg,
        }}
      >
        <GlassCard>
          {permissions.isLoading ? (
            <SkeletonList count={2} lines={1} />
          ) : permissions.members.length === 0 ? (
            <EmptyState
              icon={Users}
              title="Nenhum viajante"
              message="Não foi possível carregar a lista de viajantes desta viagem."
              compact
            />
          ) : (
            permissions.members.map((member, index) => (
              <View key={member.id}>
                {index > 0 ? <Divider /> : null}
                <MemberRow
                  member={member}
                  selfId={user?.id}
                  onManage={permissions.canManageMembers ? setManaging : undefined}
                />
              </View>
            ))
          )}
        </GlassCard>

        {invites.length > 0 ? (
          <View style={{ gap: theme.spacing.sm }}>
            <AppText variant="label" color="secondary">
              Convites enviados
            </AppText>
            <GlassCard>
              {invites.map((invite, index) => (
                <View key={invite.id}>
                  {index > 0 ? <Divider /> : null}
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: theme.spacing.md,
                      paddingVertical: theme.spacing.md,
                    }}
                  >
                    <Clock3 size={18} color={theme.colors.textTertiary} />
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <AppText variant="bodySmall" weight="semibold" numberOfLines={1}>
                        {invite.invitedName ?? 'Convite pendente'}
                      </AppText>
                      <AppText variant="caption" color="secondary">
                        {`Convite enviado · ${ROLE_LABEL[invite.role]}`}
                      </AppText>
                    </View>
                    <Button
                      label="Cancelar"
                      variant="ghost"
                      size="sm"
                      icon={X}
                      onPress={() => void handleCancelInvite(invite.id)}
                    />
                  </View>
                </View>
              ))}
            </GlassCard>
          </View>
        ) : null}

        {demoMode ? (
          <InlineNotice icon={Users}>
            O Easy Trip está em modo demonstração, com os dados guardados só neste aparelho.
            Convidar outros viajantes fica disponível quando o aplicativo estiver conectado.
          </InlineNotice>
        ) : permissions.canManageMembers ? (
          <Button
            label="Convidar viajante"
            icon={UserPlus}
            size="lg"
            fullWidth
            onPress={() => setInviteOpen(true)}
          />
        ) : (
          <InlineNotice>
            Só quem é proprietário da viagem pode convidar ou remover viajantes.
          </InlineNotice>
        )}

        {canTransfer ? (
          <Button
            label="Transferir propriedade"
            variant="secondary"
            icon={Crown}
            fullWidth
            onPress={() => setTransferPicker(true)}
          />
        ) : null}

        {permissions.canLeave && permissions.role !== 'owner' ? (
          <Button
            label="Sair desta viagem"
            variant="ghost"
            icon={LogOut}
            fullWidth
            onPress={() => setLeaving(true)}
          />
        ) : null}

        {permissions.role === 'owner' && permissions.memberCount > 1 ? (
          <AppText variant="caption" color="tertiary">
            Como proprietário, você não pode sair da viagem enquanto houver outros viajantes.
            Transfira a propriedade a um deles, remova-os, ou exclua a viagem.
          </AppText>
        ) : null}
      </ScrollView>

      <InviteSheet
        visible={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onInvite={handleInvite}
        pending={mutations.invite.isPending}
      />

      <BottomSheet
        visible={Boolean(managing)}
        onClose={() => setManaging(null)}
        title={managing ? memberDisplayName(managing, user?.id) : ''}
        subtitle={managing ? ROLE_LABEL[managing.role] : undefined}
      >
        <View style={{ gap: theme.spacing.md }}>
          <Button
            label="Pode editar"
            variant={managing?.role === 'editor' ? 'primary' : 'secondary'}
            fullWidth
            onPress={() => managing && void handleRoleChange(managing, 'editor')}
          />
          <Button
            label="Somente visualizar"
            variant={managing?.role === 'viewer' ? 'primary' : 'secondary'}
            fullWidth
            onPress={() => managing && void handleRoleChange(managing, 'viewer')}
          />
          <Divider spacing={theme.spacing.sm} />
          <Button
            label="Remover da viagem"
            variant="ghost"
            icon={LogOut}
            fullWidth
            onPress={() => {
              const target = managing;
              setManaging(null);
              setRemoving(target);
            }}
          />
        </View>
      </BottomSheet>

      <ConfirmDialog
        visible={Boolean(removing)}
        title="Remover viajante?"
        message={
          removing
            ? `${memberDisplayName(removing, user?.id)} perde o acesso a esta viagem imediatamente. ` +
              'O que essa pessoa criou e compartilhou continua na viagem; o conteúdo privado dela ' +
              'permanece inacessível para todos.'
            : ''
        }
        confirmLabel="Remover"
        destructive
        loading={mutations.removeMember.isPending}
        onConfirm={() => void handleRemove()}
        onCancel={() => setRemoving(null)}
      />

      {/*
        Escolher para quem transferir.

        A lista é `transferCandidates`, que já exclui o próprio proprietário e
        quem só tem convite pendente — as mesmas pessoas que
        `transfer_trip_ownership` (0014) aceita. Oferecer aqui alguém que a
        função recusaria transformaria uma regra do banco num erro de tela.
      */}
      <BottomSheet
        visible={transferPicker}
        onClose={() => setTransferPicker(false)}
        title="Transferir propriedade"
        subtitle="Escolha quem passa a ser o proprietário desta viagem"
      >
        <View style={{ gap: theme.spacing.sm }}>
          {candidates.map((member) => (
            <Button
              key={member.id}
              label={`${memberDisplayName(member, user?.id)} · ${ROLE_LABEL[member.role]}`}
              variant="secondary"
              fullWidth
              onPress={() => {
                setTransferPicker(false);
                setTransferTarget(member);
              }}
            />
          ))}
          <AppText variant="caption" color="tertiary">
            Só aparecem viajantes que já aceitaram o convite. Quem ainda não
            respondeu não pode receber a viagem.
          </AppText>
        </View>
      </BottomSheet>

      {/*
        A confirmação NÃO é `destructive`.

        Transferir não destrói nada — o conteúdo fica, as pessoas ficam, e quem
        transfere continua na viagem como editor. Pintar de vermelho e escrever
        "Excluir" ensinaria a pessoa a ler o diálogo de exclusão de viagem como
        se fosse este. O que o texto precisa deixar claro é outra coisa: que
        desfazer depende do outro lado.
      */}
      <ConfirmDialog
        visible={Boolean(transferTarget)}
        title="Transferir esta viagem?"
        message={transferTarget ? transferWarning(memberDisplayName(transferTarget, user?.id)) : ''}
        confirmLabel="Transferir"
        loading={mutations.transferOwnership.isPending}
        onConfirm={() => void handleTransfer()}
        onCancel={() => setTransferTarget(null)}
      />

      <ConfirmDialog
        visible={leaving}
        title="Sair desta viagem?"
        message="Você perde o acesso ao conteúdo compartilhado. O que você criou e compartilhou continua com o grupo; o que é privado sai com você."
        confirmLabel="Sair"
        destructive
        loading={mutations.leave.isPending}
        onConfirm={() => void handleLeave()}
        onCancel={() => setLeaving(false)}
      />
    </View>
  );
}

function memberActionError(error: unknown, fallback: string): string {
  return describeBackendCapability(error) ?? (error instanceof Error ? error.message : fallback);
}
