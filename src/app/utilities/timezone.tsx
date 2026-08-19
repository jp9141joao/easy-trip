import { useRouter } from 'expo-router';
import { ArrowRight, Clock3, Moon, Sun, TriangleAlert } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AppHeader,
  AppText,
  Badge,
  EmptyState,
  GlassCard,
  InlineNotice,
  SectionHeader,
} from '@/components/ui';
import { AuroraBackground } from '@/components/ui/Surface';
import { useCurrentTrip } from '@/hooks/useTrips';
import { useAuth } from '@/providers/AuthProvider';
import {
  compareTimezones,
  getDeviceTimezone,
  supportsTimezones,
  timezoneCityLabel,
  type ZoneClock,
} from '@/services/timezone';
import { useTheme } from '@/theme';

/**
 * Timezone comparison (§63).
 *
 * Everything is computed live from IANA zones via `Intl`, so DST and
 * fractional offsets are handled correctly — no fixed offset tables.
 */
export default function TimezoneScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { trip } = useCurrentTrip();
  const { profile } = useAuth();

  const [now, setNow] = useState(() => new Date());
  const supported = useMemo(() => supportsTimezones(), []);

  // Tick every second so the clocks stay live.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const originZone = profile?.homeTimezone || getDeviceTimezone();
  const comparison = useMemo(() => {
    if (!trip || !supported) return null;
    try {
      return compareTimezones(originZone, trip.timezone, now);
    } catch {
      return null;
    }
  }, [trip, originZone, now, supported]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AuroraBackground />

      <View style={{ paddingHorizontal: theme.spacing.screen }}>
        <AppHeader
          label="Utilidades"
          title="Fuso horário"
          subtitle={trip ? `Origem e ${trip.destinationCity}` : undefined}
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
        {!trip ? (
          <GlassCard>
            <EmptyState
              icon={Clock3}
              title="Nenhuma viagem ativa"
              message="Selecione uma viagem para comparar o horário com o destino."
              actionLabel="Ver viagens"
              onAction={() => router.replace('/(tabs)/trips')}
            />
          </GlassCard>
        ) : !supported || !comparison ? (
          <InlineNotice icon={TriangleAlert} tone="warning">
            Este dispositivo não conseguiu resolver fusos horários IANA. Não vamos exibir um horário
            que pode estar incorreto.
          </InlineNotice>
        ) : (
          <>
            <ClockCard
              title="Você"
              subtitle={timezoneCityLabel(comparison.origin.timezone)}
              clock={comparison.origin}
            />

            <View style={{ alignItems: 'center', gap: theme.spacing.sm }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.spacing.sm,
                  backgroundColor: theme.colors.primarySoft,
                  paddingHorizontal: theme.spacing.lg,
                  paddingVertical: theme.spacing.sm,
                  borderRadius: theme.radius.pill,
                }}
              >
                <ArrowRight size={16} color={theme.colors.primary} />
                <AppText variant="bodySmall" color="brand" weight="semibold">
                  {comparison.differenceLabel}
                </AppText>
              </View>
            </View>

            <ClockCard
              title={trip.destinationCity}
              subtitle={timezoneCityLabel(comparison.destination.timezone)}
              clock={comparison.destination}
              highlight
            />

            <View>
              <SectionHeader title="Detalhes" />
              <GlassCard>
                <View style={{ gap: theme.spacing.md }}>
                  <DetailRow label="Seu fuso" value={comparison.origin.timezone} />
                  <DetailRow label="Fuso do destino" value={comparison.destination.timezone} />
                  <DetailRow label="Deslocamento origem" value={comparison.origin.offsetLabel} />
                  <DetailRow
                    label="Deslocamento destino"
                    value={comparison.destination.offsetLabel}
                  />
                  <DetailRow
                    label="Diferença"
                    value={`${comparison.differenceMinutes > 0 ? '+' : ''}${comparison.differenceMinutes} min`}
                  />
                </View>
              </GlassCard>
            </View>

            <InlineNotice icon={Clock3}>
              Os horários são calculados em tempo real a partir dos fusos IANA, considerando horário
              de verão e deslocamentos fracionários.
            </InlineNotice>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function ClockCard({
  title,
  subtitle,
  clock,
  highlight = false,
}: {
  title: string;
  subtitle: string;
  clock: ZoneClock;
  highlight?: boolean;
}) {
  const theme = useTheme();

  return (
    <GlassCard elevation={highlight ? 'md' : 'sm'}>
      <View style={{ gap: theme.spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
          <View style={{ flex: 1 }}>
            <AppText variant="body" weight="semibold" numberOfLines={1}>
              {title}
            </AppText>
            <AppText variant="caption" color="secondary" numberOfLines={1}>
              {subtitle}
            </AppText>
          </View>

          <Badge
            label={clock.isDay ? 'Dia' : 'Noite'}
            tone={clock.isDay ? 'warning' : 'brand'}
            icon={clock.isDay ? Sun : Moon}
          />
        </View>

        <AppText variant="display" mono weight="bold" style={{ fontSize: 44, lineHeight: 50 }}>
          {clock.time}
        </AppText>

        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <AppText variant="caption" color="secondary">
            {clock.date}
          </AppText>
          <AppText variant="caption" color="tertiary" mono>
            {clock.offsetLabel}
          </AppText>
        </View>
      </View>
    </GlassCard>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.spacing.md }}>
      <AppText variant="caption" color="tertiary">
        {label}
      </AppText>
      <AppText variant="caption" mono numberOfLines={1} style={{ flex: 1 }} align="right">
        {value}
      </AppText>
    </View>
  );
}
