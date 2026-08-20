import { CalendarDays, MapPin, Wallet } from 'lucide-react-native';
import { View } from 'react-native';

import { AppImage, AppText, GlassCard } from '@/components/ui';
import { TripStatusChip } from '@/components/trip';
import { getCountdownLabel, getTripTimingLabel } from '@/domain/selectors';
import type { Trip } from '@/domain/types';
import { formatMoney } from '@/lib/currency';
import { formatDateRange } from '@/lib/date';
import { useTheme } from '@/theme';

export function TripCard({
  trip,
  onPress,
  spent,
}: {
  trip: Trip;
  onPress: () => void;
  /** Optional actual spend so the card can show the real remaining budget. */
  spent?: number;
}) {
  const theme = useTheme();
  const timing = getTripTimingLabel(trip);
  const remaining = spent === undefined ? undefined : trip.budgetTotal - spent;

  return (
    <GlassCard
      padded={false}
      elevation="md"
      onPress={onPress}
      accessibilityLabel={`${trip.destinationCity}, ${trip.destinationCountry}. ${formatDateRange(trip.startDate, trip.endDate)}. ${getCountdownLabel(trip)}`}
      accessibilityHint="Abre os detalhes da viagem"
    >
      <AppImage
        uri={trip.coverImageUrl}
        style={{ height: 148, width: '100%' }}
        fallbackLabel={trip.destinationCity}
        overlay
      />

      <View
        style={{
          position: 'absolute',
          top: theme.spacing.lg,
          right: theme.spacing.lg,
        }}
      >
        <TripStatusChip trip={trip} />
      </View>

      <View style={{ padding: theme.spacing.xl, gap: theme.spacing.md }}>
        <View>
          <AppText variant="h3" numberOfLines={1}>
            {trip.destinationCity}
          </AppText>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <MapPin size={13} color={theme.colors.textSecondary} />
            <AppText variant="bodySmall" color="secondary" numberOfLines={1}>
              {trip.destinationCountry}
            </AppText>
          </View>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.lg }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
            <CalendarDays size={14} color={theme.colors.textTertiary} />
            <AppText variant="caption" color="secondary" numberOfLines={1}>
              {formatDateRange(trip.startDate, trip.endDate)}
            </AppText>
          </View>

          {timing ? (
            <AppText variant="caption" color="brand" weight="semibold">
              {timing}
            </AppText>
          ) : null}
        </View>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            borderTopWidth: 1,
            borderTopColor: theme.colors.border,
            paddingTop: theme.spacing.md,
          }}
        >
          <Wallet size={14} color={theme.colors.textTertiary} />
          <AppText variant="caption" color="secondary">
            {remaining === undefined
              ? `Orçamento ${formatMoney(trip.budgetTotal, trip.budgetCurrency)}`
              : `Restam ${formatMoney(remaining, trip.budgetCurrency)} de ${formatMoney(trip.budgetTotal, trip.budgetCurrency)}`}
          </AppText>
        </View>
      </View>
    </GlassCard>
  );
}
