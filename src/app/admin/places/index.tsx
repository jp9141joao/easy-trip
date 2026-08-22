import { useRouter } from 'expo-router';
import { Plus } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AppHeader,
  AppText,
  Badge,
  Button,
  EmptyState,
  GlassCard,
  SearchInput,
  SegmentedTabs,
  SkeletonList,
} from '@/components/ui';
import { AuroraBackground } from '@/components/ui/Surface';
import { normalizeKey } from '@/data/images';
import { useAdminPlaces } from '@/hooks/useAdminContent';
import { PLACE_TYPE_LABEL } from '@/lib/labels';
import { normalizeExternalUrl } from '@/lib/url';
import { useTheme } from '@/theme';

type TypeFilter = 'all' | 'hotel' | 'restaurant';

export default function AdminPlacesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { data: places, isLoading } = useAdminPlaces();
  const [search, setSearch] = useState('');
  const [type, setType] = useState<TypeFilter>('all');

  const visible = useMemo(() => {
    const term = normalizeKey(search);
    return (places ?? []).filter((place) => {
      if (type !== 'all' && place.type !== type) return false;
      if (!term) return true;
      return (
        normalizeKey(place.name).includes(term) || normalizeKey(place.city).includes(term)
      );
    });
  }, [places, search, type]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AuroraBackground />

      <View style={{ paddingHorizontal: theme.spacing.screen }}>
        <AppHeader label="Painel de Conteúdo" title="Restaurantes e Hotéis" showBack />
      </View>

      <View style={{ paddingHorizontal: theme.spacing.screen, gap: theme.spacing.md }}>
        <SearchInput value={search} onChangeText={setSearch} placeholder="Buscar por nome ou cidade" />
        <SegmentedTabs
          value={type}
          onChange={setType}
          items={[
            { value: 'all', label: 'Todos' },
            { value: 'restaurant', label: 'Restaurantes' },
            { value: 'hotel', label: 'Hotéis' },
          ]}
        />
        <Button
          label="Novo local"
          icon={Plus}
          fullWidth
          onPress={() => router.push('/admin/places/new')}
        />
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.screen,
          paddingTop: theme.spacing.lg,
          paddingBottom: insets.bottom + theme.spacing['3xl'],
          gap: theme.spacing.md,
        }}
      >
        {isLoading ? (
          <SkeletonList count={4} />
        ) : visible.length === 0 ? (
          <GlassCard>
            <EmptyState
              title={search || type !== 'all' ? 'Nada encontrado' : 'Nenhum local ainda'}
              message={
                search || type !== 'all'
                  ? 'Ajuste a busca ou o filtro para ver outros locais.'
                  : 'Cadastre o primeiro restaurante ou hotel.'
              }
            />
          </GlassCard>
        ) : (
          visible.map((place) => (
            <GlassCard key={place.id} onPress={() => router.push(`/admin/places/${place.id}`)}>
              <View style={{ gap: theme.spacing.sm }}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: theme.spacing.sm,
                  }}
                >
                  <AppText variant="bodySmall" weight="semibold" style={{ flex: 1 }} numberOfLines={2}>
                    {place.name}
                  </AppText>
                  <Badge label={PLACE_TYPE_LABEL[place.type]} tone="brand" />
                </View>
                <AppText variant="caption" color="secondary">
                  {place.city}, {place.country}
                </AppText>
                {/*
                  Sinaliza na lista o que decide se o botão "Ver site" existirá
                  na tela pública — sem isso o admin só descobriria a ausência
                  abrindo o local no aplicativo (§12).
                */}
                {!normalizeExternalUrl(place.partnerUrl) ? (
                  <AppText variant="caption" color="tertiary">
                    Sem link externo
                  </AppText>
                ) : null}
              </View>
            </GlassCard>
          ))
        )}
      </ScrollView>
    </View>
  );
}
