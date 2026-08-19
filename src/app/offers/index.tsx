import { useRouter } from 'expo-router';
import { Tag } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OfferCard } from '@/components/cards';
import {
  AppHeader,
  Chip,
  ChipRow,
  EmptyState,
  ErrorState,
  GlassCard,
  SearchInput,
  SkeletonList,
} from '@/components/ui';
import { AuroraBackground } from '@/components/ui/Surface';
import type { CostLevel } from '@/domain/types';
import { useOffers } from '@/hooks/useContent';
import { normalizeKey } from '@/data/images';
import { COST_LEVEL_LABEL } from '@/lib/labels';
import { useTheme } from '@/theme';

type Filter = 'all' | CostLevel;

export default function OffersScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: offers = [], isLoading, isError, refetch } = useOffers();

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const visible = useMemo(() => {
    const term = normalizeKey(search);
    return offers.filter((offer) => {
      if (filter !== 'all' && offer.costLevel !== filter) return false;
      if (!term) return true;
      return (
        normalizeKey(offer.destination).includes(term) ||
        normalizeKey(offer.description).includes(term)
      );
    });
  }, [offers, filter, search]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AuroraBackground />

      <View style={{ paddingHorizontal: theme.spacing.screen }}>
        <AppHeader
          label="Descobrir"
          title="Ofertas"
          subtitle="Destinos selecionados para a próxima viagem"
          showBack
        />
      </View>

      <FlatList
        data={visible}
        keyExtractor={(offer) => offer.id}
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
              placeholder="Buscar destino"
              accessibilityLabel="Buscar oferta"
            />
            <View
              style={{ marginHorizontal: -theme.spacing.screen, paddingLeft: theme.spacing.screen }}
            >
              <ChipRow>
                <Chip label="Todas" selected={filter === 'all'} onPress={() => setFilter('all')} />
                {(['economy', 'moderate', 'luxury'] as CostLevel[]).map((level) => (
                  <Chip
                    key={level}
                    label={COST_LEVEL_LABEL[level]}
                    selected={filter === level}
                    onPress={() => setFilter(level)}
                  />
                ))}
              </ChipRow>
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <OfferCard offer={item} onPress={() => router.push(`/offers/${item.id}`)} />
        )}
        ListEmptyComponent={
          isLoading ? (
            <SkeletonList count={3} lines={2} />
          ) : isError ? (
            <GlassCard>
              <ErrorState
                message="Não foi possível carregar as ofertas. Verifique sua conexão."
                onRetry={() => void refetch()}
              />
            </GlassCard>
          ) : (
            <GlassCard>
              <EmptyState
                icon={Tag}
                title="Nenhuma oferta encontrada"
                message="Ajuste a busca ou o filtro de custo."
                compact
              />
            </GlassCard>
          )
        }
      />
    </View>
  );
}
