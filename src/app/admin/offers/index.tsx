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
import { isOfferLive } from '@/domain/offerWindow';
import { useAdminOffers } from '@/hooks/useAdminContent';
import { formatShortDate, todayISO } from '@/lib/date';
import { useTheme } from '@/theme';

type StatusFilter = 'all' | 'published' | 'draft';

/**
 * Lista de ofertas do painel (F9 — a UI que a D-06 previa e que ainda não
 * existia).
 *
 * Mostra rascunho **e** oferta fora de vigência, que é o que a Home esconde. O
 * selo diz qual é o caso: "Rascunho" é decisão editorial, "Fora da vigência" é
 * o calendário — as duas somem da Home, mas por motivos diferentes, e sem essa
 * distinção o administrador não teria como saber por que a oferta não aparece.
 *
 * A regra de vigência não é reimplementada aqui: `isOfferLive` é a mesma função
 * que a fonte local usa e que espelha a policy `offers_read` (F6).
 */
export default function AdminOffersScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { data: offers, isLoading } = useAdminOffers();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');

  const visible = useMemo(() => {
    const term = normalizeKey(search);
    return (offers ?? []).filter((offer) => {
      if (status !== 'all' && offer.status !== status) return false;
      if (!term) return true;
      return normalizeKey(offer.destination).includes(term);
    });
  }, [offers, search, status]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AuroraBackground />

      <View style={{ paddingHorizontal: theme.spacing.screen }}>
        <AppHeader label="Painel de Conteúdo" title="Em Alta" showBack />
      </View>

      <View style={{ paddingHorizontal: theme.spacing.screen, gap: theme.spacing.md }}>
        <SearchInput value={search} onChangeText={setSearch} placeholder="Buscar por destino" />
        <SegmentedTabs
          value={status}
          onChange={setStatus}
          items={[
            { value: 'all', label: 'Todas' },
            { value: 'published', label: 'Publicadas' },
            { value: 'draft', label: 'Rascunhos' },
          ]}
        />
        <Button
          label="Nova oferta"
          icon={Plus}
          fullWidth
          onPress={() => router.push('/admin/offers/new')}
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
              title={search || status !== 'all' ? 'Nada encontrado' : 'Nenhuma oferta ainda'}
              message={
                search || status !== 'all'
                  ? 'Ajuste a busca ou o filtro para ver outras ofertas.'
                  : 'Cadastre a primeira oferta da faixa Em Alta.'
              }
            />
          </GlassCard>
        ) : (
          visible.map((offer) => {
            const live = isOfferLive(offer, todayISO());
            return (
              <GlassCard key={offer.id} onPress={() => router.push(`/admin/offers/${offer.id}`)}>
                <View style={{ gap: theme.spacing.sm }}>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: theme.spacing.sm,
                    }}
                  >
                    <AppText
                      variant="bodySmall"
                      weight="semibold"
                      style={{ flex: 1 }}
                      numberOfLines={2}
                    >
                      {offer.destination}
                    </AppText>
                    <Badge
                      label={offer.status === 'published' ? 'Publicada' : 'Rascunho'}
                      tone={offer.status === 'published' ? 'success' : 'neutral'}
                    />
                  </View>

                  <AppText variant="caption" color="secondary">
                    Ordem {offer.sortOrder} ·{' '}
                    {offer.activeFrom ? `de ${formatShortDate(offer.activeFrom)} ` : ''}
                    {offer.activeUntil ? `até ${formatShortDate(offer.activeUntil)}` : ''}
                    {!offer.activeFrom && !offer.activeUntil ? 'sem vigência definida' : ''}
                  </AppText>

                  {offer.status === 'published' && !live ? (
                    <Badge label="Fora da vigência — não aparece na Home" tone="warning" />
                  ) : null}
                </View>
              </GlassCard>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}
