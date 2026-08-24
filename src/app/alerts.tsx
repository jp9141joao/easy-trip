import { useRouter } from 'expo-router';
import { BellOff, Check, ChevronRight, Trash2 } from 'lucide-react-native';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AppHeader,
  AppText,
  Badge,
  Button,
  Divider,
  EmptyState,
  GlassCard,
  useToast,
} from '@/components/ui';
import { AuroraBackground } from '@/components/ui/Surface';
import {
  isActionableInvite,
  isUnread,
  notificationHref,
  type AppNotification,
} from '@/domain/notifications';
import { useAlerts, type AlertTone } from '@/hooks/useAlerts';
import { useInviteResponse } from '@/hooks/useCollaboration';
import { useNotificationMutations, useNotifications } from '@/hooks/useNotifications';
import { formatRelativeTime } from '@/lib/date';
import { useTheme } from '@/theme';

/**
 * A Central de notificações (§7).
 *
 * DUAS LISTAS, E A DIFERENÇA ENTRE ELAS É REAL
 *
 * Em cima, o que ACONTECEU: convite recebido, permissão alterada, lembrete
 * vencido, briefing do dia. São eventos — têm instante, têm lido/não lido, e
 * não podem ser recalculados porque o que os originou pode não existir mais.
 * É só esta lista que conta para o badge.
 *
 * Embaixo, o que ESTÁ ACONTECENDO: orçamento perto do limite, checklist
 * pendente, próxima atividade. São derivados do estado atual da viagem, sempre
 * verdadeiros agora, e somem sozinhos quando deixam de ser verdade. Marcar um
 * desses como "lido" não faria sentido: o orçamento continuaria em 85%.
 *
 * Juntá-los numa lista só, com o mesmo tratamento, foi a tentação óbvia — e
 * teria produzido um badge que nunca chega a zero.
 */
export default function AlertsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();

  const alerts = useAlerts();
  const { data: notifications = [], isLoading } = useNotifications();
  const mutations = useNotificationMutations();
  const inviteResponse = useInviteResponse();

  const unread = notifications.filter(isUnread).length;
  const total = notifications.length + alerts.length;

  const toneColor = (tone: AlertTone) =>
    ({
      brand: theme.colors.primary,
      warning: theme.colors.warning,
      error: theme.colors.error,
      success: theme.colors.success,
      neutral: theme.colors.textSecondary,
    })[tone];

  const toneBackground = (tone: AlertTone) =>
    ({
      brand: theme.colors.primarySoft,
      warning: theme.colors.warningSoft,
      error: theme.colors.errorSoft,
      success: theme.colors.successSoft,
      neutral: theme.colors.surfaceMuted,
    })[tone];

  const open = (notification: AppNotification) => {
    if (isUnread(notification)) mutations.markRead.mutate(notification.id);
    const href = notificationHref(notification);
    if (href) router.replace(href as never);
  };

  const accept = async (notification: AppNotification) => {
    const inviteId = notification.data.inviteId;
    if (!inviteId) return;
    try {
      await inviteResponse.accept.mutateAsync(inviteId);
      toast.success(`Você entrou em ${notification.data.destination ?? 'a viagem'}`);
      if (notification.data.tripId) router.replace(`/trip/${notification.data.tripId}` as never);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível aceitar o convite.');
    }
  };

  const decline = async (notification: AppNotification) => {
    const inviteId = notification.data.inviteId;
    if (!inviteId) return;
    try {
      await inviteResponse.decline.mutateAsync(inviteId);
      toast.success('Convite recusado');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível recusar o convite.');
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AuroraBackground />

      <View style={{ paddingHorizontal: theme.spacing.screen }}>
        <AppHeader
          label="Central de notificações"
          title="Notificações"
          subtitle={
            total === 0
              ? 'Nada precisa da sua atenção'
              : unread > 0
                ? `${unread} não ${unread === 1 ? 'lida' : 'lidas'}`
                : `${total} ${total === 1 ? 'item' : 'itens'}`
          }
          showBack
        />
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.screen,
          paddingBottom: insets.bottom + theme.spacing['3xl'],
          gap: theme.spacing.md,
        }}
      >
        {total === 0 && !isLoading ? (
          <GlassCard>
            <EmptyState
              icon={BellOff}
              title="Tudo em ordem"
              message="Convites, lembretes e avisos da sua viagem aparecem aqui."
              compact
            />
          </GlassCard>
        ) : null}

        {notifications.length > 0 ? (
          <>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <AppText variant="label" color="secondary">
                Recentes
              </AppText>
              {unread > 0 ? (
                <Button
                  label="Marcar todas como lidas"
                  variant="ghost"
                  size="sm"
                  icon={Check}
                  onPress={() => mutations.markAllRead.mutate()}
                />
              ) : null}
            </View>

            {notifications.map((notification) => (
              <GlassCard
                key={notification.id}
                onPress={() => open(notification)}
                accessibilityLabel={[
                  notification.title,
                  notification.body,
                  isUnread(notification) ? 'Não lida' : null,
                ]
                  .filter(Boolean)
                  .join('. ')}
              >
                <View style={{ gap: theme.spacing.sm }}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.md }}>
                    {/*
                      O ponto de não lida é acompanhado do texto "Não lida" no
                      rótulo de acessibilidade: quem não distingue o ponto ainda
                      precisa saber o estado (§70).
                    */}
                    <View
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        marginTop: 6,
                        backgroundColor: isUnread(notification)
                          ? theme.colors.primary
                          : 'transparent',
                      }}
                    />
                    <View style={{ flex: 1, gap: 2 }}>
                      <AppText
                        variant="body"
                        weight={isUnread(notification) ? 'semibold' : 'regular'}
                      >
                        {notification.title}
                      </AppText>
                      {notification.body ? (
                        <AppText variant="caption" color="secondary">
                          {notification.body}
                        </AppText>
                      ) : null}
                      <AppText variant="caption" color="tertiary">
                        {formatRelativeTime(notification.createdAt)}
                      </AppText>
                    </View>

                    <Button
                      label=""
                      variant="ghost"
                      size="sm"
                      icon={Trash2}
                      accessibilityLabel={`Remover notificação: ${notification.title}`}
                      onPress={() => mutations.remove.mutate(notification.id)}
                    />
                  </View>

                  {/*
                    O convite é respondido de dentro da própria notificação
                    (§6). Mandar a pessoa procurar a viagem para aceitar seria
                    impossível: ela ainda não tem acesso a essa viagem.
                  */}
                  {isActionableInvite(notification) ? (
                    <>
                      <Divider />
                      {notification.data.role ? (
                        <Badge
                          label={
                            notification.data.role === 'editor'
                              ? 'Pode editar'
                              : 'Somente visualizar'
                          }
                          tone="brand"
                        />
                      ) : null}
                      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                        <Button
                          label="Recusar"
                          variant="secondary"
                          size="sm"
                          style={{ flex: 1 }}
                          loading={inviteResponse.decline.isPending}
                          onPress={() => void decline(notification)}
                        />
                        <Button
                          label="Aceitar"
                          size="sm"
                          style={{ flex: 1 }}
                          loading={inviteResponse.accept.isPending}
                          onPress={() => void accept(notification)}
                          haptic
                        />
                      </View>
                    </>
                  ) : null}
                </View>
              </GlassCard>
            ))}
          </>
        ) : null}

        {alerts.length > 0 ? (
          <>
            <AppText variant="label" color="secondary" style={{ marginTop: theme.spacing.md }}>
              Da sua viagem agora
            </AppText>

            {alerts.map((alert) => (
              <GlassCard
                key={alert.id}
                onPress={alert.href ? () => router.replace(alert.href as never) : undefined}
                accessibilityLabel={`${alert.title}. ${alert.message}`}
                accessibilityHint={alert.href ? 'Abre a tela relacionada' : undefined}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.lg }}>
                  <View
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 21,
                      backgroundColor: toneBackground(alert.tone),
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <alert.icon size={19} color={toneColor(alert.tone)} />
                  </View>

                  <View style={{ flex: 1, gap: 2 }}>
                    <AppText variant="body" weight="semibold">
                      {alert.title}
                    </AppText>
                    <AppText variant="caption" color="secondary">
                      {alert.message}
                    </AppText>
                  </View>

                  {alert.href ? <ChevronRight size={18} color={theme.colors.textTertiary} /> : null}
                </View>
              </GlassCard>
            ))}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}
