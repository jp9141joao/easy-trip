import { useRouter } from 'expo-router';
import { BellOff, ChevronRight } from 'lucide-react-native';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppHeader, AppText, EmptyState, GlassCard } from '@/components/ui';
import { AuroraBackground } from '@/components/ui/Surface';
import { useAlerts, type AlertTone } from '@/hooks/useAlerts';
import { useTheme } from '@/theme';

/** Central de alertas (§28) — derived from real trip data, never invented. */
export default function AlertsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const alerts = useAlerts();

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

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AuroraBackground />

      <View style={{ paddingHorizontal: theme.spacing.screen }}>
        <AppHeader
          label="Central de alertas"
          title="Alertas"
          subtitle={
            alerts.length === 0
              ? 'Nada precisa da sua atenção'
              : `${alerts.length} ${alerts.length === 1 ? 'item' : 'itens'} para revisar`
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
        {alerts.length === 0 ? (
          <GlassCard>
            <EmptyState
              icon={BellOff}
              title="Tudo em ordem"
              message="Quando algo precisar da sua atenção — orçamento no limite, atividade próxima ou checklist pendente — o alerta aparece aqui."
              compact
            />
          </GlassCard>
        ) : (
          alerts.map((alert) => (
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

                {alert.href ? (
                  <ChevronRight size={18} color={theme.colors.textTertiary} />
                ) : null}
              </View>
            </GlassCard>
          ))
        )}
      </ScrollView>
    </View>
  );
}
