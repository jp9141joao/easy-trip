import { useRouter } from 'expo-router';
import { ChevronLeft, CloudSun, Clock3, LifeBuoy, Map as MapIcon, Pencil } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AppImage,
  AppText,
  Badge,
  IconButton,
  SegmentedTabs,
  type SegmentedTabItem,
} from '@/components/ui';
import { getCountdownLabel, getTripStatus, TRIP_STATUS_LABEL } from '@/domain/selectors';
import type { Trip } from '@/domain/types';
import { formatDateRange } from '@/lib/date';
import { formatMoney } from '@/lib/currency';
import { useTheme } from '@/theme';

export type TripSection = 'itinerary' | 'finance' | 'tickets';
export type RoteiroSection = 'itinerary' | 'checklist' | 'journal';

/**
 * Shared chrome for every trip screen (§33).
 *
 * The hero always renders the trip whose `tripId` is in the route, which is why
 * the header can never disagree with the content below it (CA-01).
 */
export function TripHero({
  trip,
  spent,
  onEdit,
}: {
  trip: Trip;
  spent?: number;
  onEdit?: () => void;
}) {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const status = getTripStatus(trip);

  return (
    <View>
      <AppImage
        uri={trip.coverImageUrl}
        style={{ height: 240 + insets.top, width: '100%' }}
        fallbackLabel={trip.destinationCity}
        overlay
      />

      <View
        style={{
          position: 'absolute',
          top: insets.top + theme.spacing.sm,
          left: theme.spacing.screen,
          right: theme.spacing.screen,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.sm,
        }}
      >
        <IconButton
          icon={ChevronLeft}
          accessibilityLabel="Voltar"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/trips'))}
          background="glass"
          color={theme.colors.textOnImage}
        />

        <View style={{ flex: 1 }} />

        <IconButton
          icon={CloudSun}
          accessibilityLabel="Clima do destino"
          onPress={() => router.push('/utilities/weather')}
          background="glass"
          color={theme.colors.textOnImage}
        />
        <IconButton
          icon={Clock3}
          accessibilityLabel="Fuso horário"
          onPress={() => router.push('/utilities/timezone')}
          background="glass"
          color={theme.colors.textOnImage}
        />
        <IconButton
          icon={MapIcon}
          accessibilityLabel="Mapa"
          onPress={() => router.push('/utilities/map')}
          background="glass"
          color={theme.colors.textOnImage}
        />
        <IconButton
          icon={LifeBuoy}
          accessibilityLabel="Emergência e SOS"
          onPress={() => router.push('/utilities/sos')}
          background="glass"
          color={theme.colors.textOnImage}
        />
      </View>

      <View
        style={{
          position: 'absolute',
          left: theme.spacing.screen,
          right: theme.spacing.screen,
          bottom: theme.spacing.lg,
          gap: 6,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
          <Badge
            label={TRIP_STATUS_LABEL[status]}
            tone={status === 'active' ? 'success' : status === 'upcoming' ? 'brand' : 'neutral'}
          />
          <Badge label={getCountdownLabel(trip)} tone="accent" />
          <View style={{ flex: 1 }} />
          {onEdit ? (
            <IconButton
              icon={Pencil}
              accessibilityLabel="Editar viagem"
              onPress={onEdit}
              background="glass"
              color={theme.colors.textOnImage}
              size={16}
            />
          ) : null}
        </View>

        <AppText variant="h1" color="onImage" weight="bold" numberOfLines={1}>
          {trip.destinationCity}
        </AppText>
        <AppText variant="bodySmall" color="onImage" numberOfLines={1}>
          {trip.destinationCountry} · {formatDateRange(trip.startDate, trip.endDate)}
        </AppText>

        {spent !== undefined ? (
          <AppText variant="caption" color="onImage" mono style={{ opacity: 0.9 }}>
            {formatMoney(trip.budgetTotal - spent, trip.budgetCurrency)} de{' '}
            {formatMoney(trip.budgetTotal, trip.budgetCurrency)} restantes
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

/** Primary trip tabs: Roteiro · Carteira · Tickets (§33). */
export function TripTabs({ tripId, active }: { tripId: string; active: TripSection }) {
  const theme = useTheme();
  const router = useRouter();

  const items: SegmentedTabItem<TripSection>[] = [
    { value: 'itinerary', label: 'Roteiro' },
    { value: 'finance', label: 'Carteira' },
    { value: 'tickets', label: 'Tickets' },
  ];

  return (
    <View style={{ paddingHorizontal: theme.spacing.screen, paddingVertical: theme.spacing.lg }}>
      <SegmentedTabs<TripSection>
        items={items}
        value={active}
        onChange={(value) => {
          if (value === active) return;
          router.replace(`/trip/${tripId}/${value}`);
        }}
      />
    </View>
  );
}

/** Secondary tabs inside Roteiro: Jornada · Checklist · Diário (§22). */
export function RoteiroTabs({
  tripId,
  active,
  checklistBadge,
}: {
  tripId: string;
  active: RoteiroSection;
  checklistBadge?: number;
}) {
  const theme = useTheme();
  const router = useRouter();

  const items: SegmentedTabItem<RoteiroSection>[] = [
    { value: 'itinerary', label: 'Jornada' },
    { value: 'checklist', label: 'Checklist', badge: checklistBadge },
    { value: 'journal', label: 'Diário' },
  ];

  return (
    <View style={{ paddingHorizontal: theme.spacing.screen, paddingBottom: theme.spacing.lg }}>
      <SegmentedTabs<RoteiroSection>
        items={items}
        value={active}
        onChange={(value) => {
          if (value === active) return;
          router.replace(`/trip/${tripId}/${value}`);
        }}
      />
    </View>
  );
}

export function TripScreenShell({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <View style={{ flex: 1, backgroundColor: theme.colors.background }}>{children}</View>;
}
