import { useRouter } from 'expo-router';
import { Compass, Plus } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TripCard } from '@/components/cards';
import {
  AppText,
  Chip,
  ChipRow,
  EmptyState,
  ErrorState,
  FloatingActionButton,
  GlassCard,
  OfflineBanner,
  PageLabel,
  SkeletonList,
} from '@/components/ui';
import { AuroraBackground } from '@/components/ui/Surface';
import { DOCK_CLEARANCE } from '@/constants/layout';
import { getTripStatus } from '@/domain/selectors';
import type { TripStatus } from '@/domain/types';
import { useTrips } from '@/hooks/useTrips';
import { useConnectivity } from '@/providers/ConnectivityProvider';
import { useTripSelection } from '@/providers/TripSelectionProvider';
import { describeBackendCapability } from '@/repositories/backendCapabilities';
import { useTheme } from '@/theme';

type Filter = 'all' | TripStatus;

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'upcoming', label: 'Planejadas' },
  { value: 'active', label: 'Em andamento' },
  { value: 'completed', label: 'Concluídas' },
];

export default function TripsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isOffline } = useConnectivity();
  const { setCurrentTripId } = useTripSelection();
  const [filter, setFilter] = useState<Filter>('all');

  const { data: trips = [], isLoading, isError, error, refetch } = useTrips();

  const filtered = useMemo(
    () => (filter === 'all' ? trips : trips.filter((trip) => getTripStatus(trip) === filter)),
    [trips, filter],
  );

  const openTrip = (tripId: string) => {
    // Selecting from the list also switches the active trip (§99, fluxo 3).
    setCurrentTripId(tripId);
    router.push(`/trip/${tripId}`);
  };

  // Um único CTA para a primeira criação: quando o empty state já oferece a
  // ação, o FAB logo abaixo seria o mesmo botão duas vezes (§20). Assim que
  // existe conteúdo, o FAB volta ao comportamento normal.
  const emptyCtaVisible = !isLoading && !isError && trips.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AuroraBackground />

      <FlatList
        data={filtered}
        keyExtractor={(trip) => trip.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: insets.top + theme.spacing.sm,
          paddingBottom: DOCK_CLEARANCE + theme.spacing['4xl'],
          gap: theme.spacing.lg,
        }}
        ListHeaderComponent={
          <View style={{ gap: theme.spacing.lg, marginBottom: theme.spacing.sm }}>
            <View style={{ paddingHorizontal: theme.spacing.screen }}>
              <PageLabel>Suas viagens</PageLabel>
              <AppText variant="h1">Minhas viagens</AppText>
              <AppText variant="bodySmall" color="secondary">
                {trips.length === 0
                  ? 'Nenhuma viagem por enquanto'
                  : `${trips.length} ${trips.length === 1 ? 'viagem' : 'viagens'}`}
              </AppText>
            </View>

            {isOffline ? (
              <View style={{ paddingHorizontal: theme.spacing.screen }}>
                <OfflineBanner />
              </View>
            ) : null}

            <View style={{ paddingLeft: theme.spacing.screen }}>
              <ChipRow>
                {FILTERS.map((item) => (
                  <Chip
                    key={item.value}
                    label={item.label}
                    selected={filter === item.value}
                    onPress={() => setFilter(item.value)}
                  />
                ))}
              </ChipRow>
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <View style={{ paddingHorizontal: theme.spacing.screen }}>
            <TripCard trip={item} onPress={() => openTrip(item.id)} />
          </View>
        )}
        ListEmptyComponent={
          <View style={{ paddingHorizontal: theme.spacing.screen }}>
            {isLoading ? (
              <SkeletonList count={3} lines={3} />
            ) : isError ? (
              <GlassCard>
                <ErrorState
                  message={
                    describeBackendCapability(error) ??
                    'Não foi possível carregar suas viagens. Verifique sua conexão e tente novamente.'
                  }
                  onRetry={() => void refetch()}
                />
              </GlassCard>
            ) : trips.length === 0 ? (
              <GlassCard>
                <EmptyState
                  icon={Compass}
                  title="Você ainda não criou nenhuma viagem"
                  message="Comece pelo destino e pelas datas — o resto você organiza depois."
                  actionLabel="Planejar primeira viagem"
                  onAction={() => router.push('/trips/new')}
                />
              </GlassCard>
            ) : (
              <GlassCard>
                <EmptyState
                  icon={Compass}
                  title="Nenhuma viagem neste filtro"
                  message="Troque o filtro para ver suas outras viagens."
                  compact
                />
              </GlassCard>
            )}
          </View>
        }
      />

      {emptyCtaVisible ? null : (
        <FloatingActionButton
          icon={Plus}
          label="Nova viagem"
          onPress={() => router.push('/trips/new')}
          bottomOffset={DOCK_CLEARANCE - theme.spacing.md}
        />
      )}
    </View>
  );
}
