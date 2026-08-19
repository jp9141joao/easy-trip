import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { ExternalLink, Map as MapIcon, MapPin, Navigation } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Platform, ScrollView, View } from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AppHeader,
  AppText,
  Badge,
  Button,
  Chip,
  ChipRow,
  EmptyState,
  GlassCard,
  useToast,
} from '@/components/ui';
import { AuroraBackground } from '@/components/ui/Surface';
import type { ItineraryItem, Place } from '@/domain/types';
import { usePlaces } from '@/hooks/useContent';
import { useCurrentTrip } from '@/hooks/useTrips';
import { useItinerary } from '@/hooks/useTripData';
import { ITINERARY_TYPE_LABEL, PLACE_TYPE_LABEL } from '@/lib/labels';
import { useTheme } from '@/theme';

type Pin = {
  id: string;
  title: string;
  subtitle: string;
  latitude: number;
  longitude: number;
  kind: 'destination' | 'place' | 'activity';
};

/**
 * Interactive map (§64).
 *
 * `react-native-maps` is bundled with Expo Go on SDK 57, so this is a real map —
 * not a static image pretending to be one. Pins come from the trip's own
 * coordinates, its itinerary and the place directory, and every pin can hand off
 * to the system maps app for turn-by-turn navigation.
 */
export default function MapScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();

  const { trip } = useCurrentTrip();
  const { data: itinerary = [] } = useItinerary(trip?.id);
  const { data: places = [] } = usePlaces(trip ? { city: trip.destinationCity } : undefined);

  const [filter, setFilter] = useState<'all' | 'place' | 'activity'>('all');
  const [selected, setSelected] = useState<Pin | null>(null);

  const pins = useMemo<Pin[]>(() => {
    if (!trip) return [];
    const list: Pin[] = [];

    if (typeof trip.latitude === 'number' && typeof trip.longitude === 'number') {
      list.push({
        id: `trip-${trip.id}`,
        title: trip.destinationCity,
        subtitle: trip.destinationCountry,
        latitude: trip.latitude,
        longitude: trip.longitude,
        kind: 'destination',
      });
    }

    for (const place of places as Place[]) {
      if (typeof place.latitude !== 'number' || typeof place.longitude !== 'number') continue;
      list.push({
        id: `place-${place.id}`,
        title: place.name,
        subtitle: PLACE_TYPE_LABEL[place.type],
        latitude: place.latitude,
        longitude: place.longitude,
        kind: 'place',
      });
    }

    for (const item of itinerary as ItineraryItem[]) {
      if (typeof item.latitude !== 'number' || typeof item.longitude !== 'number') continue;
      list.push({
        id: `activity-${item.id}`,
        title: item.title,
        subtitle: ITINERARY_TYPE_LABEL[item.type],
        latitude: item.latitude,
        longitude: item.longitude,
        kind: 'activity',
      });
    }

    return list;
  }, [trip, places, itinerary]);

  const visiblePins = useMemo(
    () => (filter === 'all' ? pins : pins.filter((pin) => pin.kind === filter || pin.kind === 'destination')),
    [pins, filter],
  );

  const region = useMemo(() => {
    if (!trip || typeof trip.latitude !== 'number' || typeof trip.longitude !== 'number') {
      return null;
    }
    return {
      latitude: trip.latitude,
      longitude: trip.longitude,
      latitudeDelta: 0.12,
      longitudeDelta: 0.12,
    };
  }, [trip]);

  /** Hands the pin to the platform's maps app for real navigation. */
  const navigateTo = async (pin: Pin) => {
    const label = encodeURIComponent(pin.title);
    const url = Platform.select({
      ios: `maps://?q=${label}&ll=${pin.latitude},${pin.longitude}`,
      android: `geo:${pin.latitude},${pin.longitude}?q=${pin.latitude},${pin.longitude}(${label})`,
      default: `https://www.google.com/maps/search/?api=1&query=${pin.latitude},${pin.longitude}`,
    });
    try {
      await Linking.openURL(url);
    } catch {
      await Linking.openURL(
        `https://www.google.com/maps/search/?api=1&query=${pin.latitude},${pin.longitude}`,
      ).catch(() => toast.error('Não foi possível abrir o mapa externo.'));
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AuroraBackground />

      <View style={{ paddingHorizontal: theme.spacing.screen }}>
        <AppHeader
          label="Utilidades"
          title="Mapa"
          subtitle={trip ? trip.destinationCity : undefined}
          showBack
        />
      </View>

      {!trip || !region ? (
        <View style={{ paddingHorizontal: theme.spacing.screen }}>
          <GlassCard>
            <EmptyState
              icon={MapIcon}
              title={trip ? 'Destino sem coordenadas' : 'Nenhuma viagem ativa'}
              message={
                trip
                  ? 'Esta viagem foi criada sem localização geográfica. Edite a viagem e selecione o destino na busca.'
                  : 'Selecione uma viagem para ver o mapa do destino.'
              }
              actionLabel={trip ? 'Editar viagem' : 'Ver viagens'}
              onAction={() =>
                trip ? router.push(`/trip/${trip.id}/edit`) : router.replace('/(tabs)/trips')
              }
            />
          </GlassCard>
        </View>
      ) : (
        <>
          <View
            style={{
              marginHorizontal: theme.spacing.screen,
              borderRadius: theme.radius.card,
              overflow: 'hidden',
              height: 320,
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}
          >
            <MapView
              provider={PROVIDER_DEFAULT}
              style={{ flex: 1 }}
              initialRegion={region}
              accessibilityLabel={`Mapa de ${trip.destinationCity}`}
            >
              {visiblePins.map((pin) => (
                <Marker
                  key={pin.id}
                  coordinate={{ latitude: pin.latitude, longitude: pin.longitude }}
                  title={pin.title}
                  description={pin.subtitle}
                  pinColor={
                    pin.kind === 'destination'
                      ? theme.colors.accent
                      : pin.kind === 'activity'
                        ? theme.colors.success
                        : theme.colors.primary
                  }
                  onPress={() => setSelected(pin)}
                />
              ))}
            </MapView>
          </View>

          <View style={{ paddingLeft: theme.spacing.screen, paddingVertical: theme.spacing.lg }}>
            <ChipRow>
              <Chip label="Tudo" selected={filter === 'all'} onPress={() => setFilter('all')} />
              <Chip
                label="Lugares"
                selected={filter === 'place'}
                onPress={() => setFilter('place')}
              />
              <Chip
                label="Roteiro"
                selected={filter === 'activity'}
                onPress={() => setFilter('activity')}
              />
            </ChipRow>
          </View>

          <ScrollView
            contentContainerStyle={{
              paddingHorizontal: theme.spacing.screen,
              paddingBottom: insets.bottom + theme.spacing['3xl'],
              gap: theme.spacing.md,
            }}
          >
            {selected ? (
              <GlassCard elevation="md">
                <View style={{ gap: theme.spacing.md }}>
                  <View>
                    <AppText variant="body" weight="semibold">
                      {selected.title}
                    </AppText>
                    <AppText variant="caption" color="secondary">
                      {selected.subtitle}
                    </AppText>
                  </View>
                  <Button
                    label="Abrir no aplicativo de mapas"
                    icon={Navigation}
                    fullWidth
                    onPress={() => void navigateTo(selected)}
                  />
                </View>
              </GlassCard>
            ) : null}

            {visiblePins.length === 0 ? (
              <GlassCard>
                <EmptyState
                  icon={MapPin}
                  title="Nenhum ponto neste filtro"
                  message="Adicione lugares ao roteiro com coordenadas para vê-los no mapa."
                  compact
                />
              </GlassCard>
            ) : (
              visiblePins.map((pin) => (
                <GlassCard
                  key={pin.id}
                  onPress={() => setSelected(pin)}
                  accessibilityLabel={`${pin.title}. ${pin.subtitle}`}
                  accessibilityHint="Seleciona o ponto no mapa"
                >
                  <View
                    style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}
                  >
                    <MapPin
                      size={18}
                      color={
                        pin.kind === 'destination'
                          ? theme.colors.accent
                          : pin.kind === 'activity'
                            ? theme.colors.success
                            : theme.colors.primary
                      }
                    />
                    <View style={{ flex: 1 }}>
                      <AppText variant="bodySmall" weight="semibold" numberOfLines={1}>
                        {pin.title}
                      </AppText>
                      <AppText variant="caption" color="secondary" numberOfLines={1}>
                        {pin.subtitle}
                      </AppText>
                    </View>
                    <Badge
                      label={
                        pin.kind === 'destination'
                          ? 'Destino'
                          : pin.kind === 'activity'
                            ? 'Roteiro'
                            : 'Lugar'
                      }
                      tone={
                        pin.kind === 'destination'
                          ? 'accent'
                          : pin.kind === 'activity'
                            ? 'success'
                            : 'brand'
                      }
                    />
                  </View>
                </GlassCard>
              ))
            )}

            <Button
              label="Abrir destino no mapa externo"
              icon={ExternalLink}
              variant="secondary"
              fullWidth
              onPress={() =>
                void navigateTo({
                  id: 'trip',
                  title: trip.destinationCity,
                  subtitle: trip.destinationCountry,
                  latitude: region.latitude,
                  longitude: region.longitude,
                  kind: 'destination',
                })
              }
            />
          </ScrollView>
        </>
      )}
    </View>
  );
}
