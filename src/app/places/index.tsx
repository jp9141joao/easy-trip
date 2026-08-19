import { useRouter } from 'expo-router';
import { UtensilsCrossed } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PlaceCard } from '@/components/cards';
import {
  AppHeader,
  Chip,
  ChipRow,
  EmptyState,
  ErrorState,
  GlassCard,
  InlineNotice,
  SearchInput,
  SkeletonList,
} from '@/components/ui';
import { AuroraBackground } from '@/components/ui/Surface';
import type { PlaceType } from '@/domain/types';
import { usePlaceFavorites, usePlaces } from '@/hooks/useContent';
import { useCurrentTrip } from '@/hooks/useTrips';
import { useTheme } from '@/theme';

type Filter = 'all' | PlaceType | 'favorites';

export default function PlacesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { trip } = useCurrentTrip();

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const { data: places = [], isLoading, isError, refetch } = usePlaces(
    search.trim() ? { search: search.trim() } : undefined,
  );
  const { isFavorite, toggle } = usePlaceFavorites();

  const visible = useMemo(() => {
    if (filter === 'all') return places;
    if (filter === 'favorites') return places.filter((place) => isFavorite(place.id));
    return places.filter((place) => place.type === filter);
  }, [places, filter, isFavorite]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AuroraBackground />

      <View style={{ paddingHorizontal: theme.spacing.screen }}>
        <AppHeader
          label="Descobrir"
          title="Restaurantes e hotéis"
          subtitle={trip ? `Sugestões para ${trip.destinationCity}` : undefined}
          showBack
        />
      </View>

      <FlatList
        data={visible}
        keyExtractor={(place) => place.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.screen,
          paddingBottom: insets.bottom + theme.spacing['3xl'],
        }}
        ListHeaderComponent={
          <View style={{ gap: theme.spacing.lg, marginBottom: theme.spacing.lg }}>
            <SearchInput
              value={search}
              onChangeText={setSearch}
              placeholder="Nome, cidade ou categoria"
              accessibilityLabel="Buscar lugar"
            />
            <View
              style={{ marginHorizontal: -theme.spacing.screen, paddingLeft: theme.spacing.screen }}
            >
              <ChipRow>
                <Chip label="Todos" selected={filter === 'all'} onPress={() => setFilter('all')} />
                <Chip
                  label="Restaurantes"
                  selected={filter === 'restaurant'}
                  onPress={() => setFilter('restaurant')}
                />
                <Chip
                  label="Hotéis"
                  selected={filter === 'hotel'}
                  onPress={() => setFilter('hotel')}
                />
                <Chip
                  label="Atrações"
                  selected={filter === 'attraction'}
                  onPress={() => setFilter('attraction')}
                />
                <Chip
                  label="Favoritos"
                  selected={filter === 'favorites'}
                  onPress={() => setFilter('favorites')}
                />
              </ChipRow>
            </View>

            {trip ? (
              <InlineNotice>
                O diretório mostra lugares de todos os destinos. Busque por{' '}
                {trip.destinationCity} para filtrar a sua viagem atual.
              </InlineNotice>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <PlaceCard
            place={item}
            favorite={isFavorite(item.id)}
            onToggleFavorite={() =>
              toggle.mutate({ placeId: item.id, favorite: !isFavorite(item.id) })
            }
            onPress={() => router.push(`/places/${item.id}`)}
          />
        )}
        ListEmptyComponent={
          isLoading ? (
            <SkeletonList count={3} lines={2} />
          ) : isError ? (
            <GlassCard>
              <ErrorState
                message="Não foi possível carregar os lugares. Verifique sua conexão."
                onRetry={() => void refetch()}
              />
            </GlassCard>
          ) : (
            <GlassCard>
              <EmptyState
                icon={UtensilsCrossed}
                title={filter === 'favorites' ? 'Nenhum favorito ainda' : 'Nenhum lugar encontrado'}
                message={
                  filter === 'favorites'
                    ? 'Toque no coração de um lugar para salvá-lo aqui.'
                    : 'Ajuste a busca ou escolha outra categoria.'
                }
                compact
              />
            </GlassCard>
          )
        }
      />
    </View>
  );
}
