import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { CalendarRange, ChevronLeft, CloudSun, ExternalLink, Sparkles } from 'lucide-react-native';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AppImage,
  AppText,
  Badge,
  Button,
  ErrorState,
  GlassCard,
  IconButton,
  InfoRow,
  InlineNotice,
  SectionHeader,
  SkeletonCard,
} from '@/components/ui';
import { useOffer } from '@/hooks/useContent';
import { formatMoney } from '@/lib/currency';
import { COST_LEVEL_LABEL } from '@/lib/labels';
import { useTheme } from '@/theme';

export default function OfferDetailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { offerId } = useLocalSearchParams<{ offerId: string }>();
  const { data: offer, isLoading, isError, refetch } = useOffer(offerId);

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background, padding: theme.spacing.screen, paddingTop: 100 }}>
        <SkeletonCard lines={5} height={300} />
      </View>
    );
  }

  if (isError || !offer) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background, padding: theme.spacing.screen, paddingTop: 100 }}>
        <GlassCard>
          <ErrorState
            title="Oferta não encontrada"
            message="Esta oferta pode não estar mais disponível."
            onRetry={() => (isError ? void refetch() : router.replace('/offers'))}
            retryLabel={isError ? 'Tentar novamente' : 'Ver ofertas'}
          />
        </GlassCard>
      </View>
    );
  }

  const discount = () => {
    if (!offer.discountType) return null;
    if (offer.discountType === 'percentage') return `${offer.discountValue}% de desconto`;
    if (offer.discountType === 'fixed') {
      return `${formatMoney(Number(offer.discountValue), offer.priceCurrency ?? 'BRL')} de desconto`;
    }
    return String(offer.discountValue);
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + theme.spacing['3xl'] }}
      >
        <View>
          <AppImage
            uri={offer.imageUrl}
            style={{ height: 300 + insets.top, width: '100%' }}
            fallbackLabel={offer.destination}
            overlay
          />

          <View
            style={{
              position: 'absolute',
              top: insets.top + theme.spacing.sm,
              left: theme.spacing.screen,
            }}
          >
            <IconButton
              icon={ChevronLeft}
              accessibilityLabel="Voltar"
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/offers'))}
              background="glass"
              color={theme.colors.textOnImage}
            />
          </View>

          <View
            style={{
              position: 'absolute',
              left: theme.spacing.screen,
              right: theme.spacing.screen,
              bottom: theme.spacing.xl,
              gap: theme.spacing.sm,
            }}
          >
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
              <Badge label={COST_LEVEL_LABEL[offer.costLevel]} tone="brand" />
              {discount() ? <Badge label={discount()!} tone="accent" /> : null}
            </View>
            <AppText variant="h1" color="onImage" weight="bold">
              {offer.destination}
            </AppText>
          </View>
        </View>

        <View
          style={{
            paddingHorizontal: theme.spacing.screen,
            paddingTop: theme.spacing.xl,
            gap: theme.spacing.xl,
          }}
        >
          {offer.price !== undefined ? (
            <GlassCard elevation="md">
              <View style={{ alignItems: 'center', gap: 2 }}>
                <AppText variant="caption" color="secondary" uppercase>
                  A partir de
                </AppText>
                <AppText variant="display" mono weight="bold" color="brand">
                  {formatMoney(offer.price, offer.priceCurrency ?? 'BRL')}
                </AppText>
                <AppText variant="caption" color="tertiary">
                  Valor por pessoa, sujeito a disponibilidade do parceiro.
                </AppText>
              </View>
            </GlassCard>
          ) : null}

          <View>
            <SectionHeader title="Sobre a oferta" />
            <AppText variant="body" color="secondary">
              {offer.description}
            </AppText>
          </View>

          <GlassCard>
            {offer.bestTime ? (
              <InfoRow icon={CalendarRange} label="Melhor época" value={offer.bestTime} />
            ) : null}
            {offer.weatherSummary ? (
              <InfoRow icon={CloudSun} label="Clima típico" value={offer.weatherSummary} />
            ) : null}
          </GlassCard>

          {offer.thingsToDo.length > 0 ? (
            <View>
              <SectionHeader title="O que fazer" />
              <GlassCard>
                <View style={{ gap: theme.spacing.md }}>
                  {offer.thingsToDo.map((thing) => (
                    <View
                      key={thing}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}
                    >
                      <Sparkles size={16} color={theme.colors.primary} />
                      <AppText variant="bodySmall" style={{ flex: 1 }}>
                        {thing}
                      </AppText>
                    </View>
                  ))}
                </View>
              </GlassCard>
            </View>
          ) : null}

          {/* No fake checkout (§56) — the partner completes the booking. */}
          {offer.partnerUrl ? (
            <>
              <Button
                label="Ver oferta"
                icon={ExternalLink}
                size="lg"
                fullWidth
                onPress={() => void WebBrowser.openBrowserAsync(offer.partnerUrl!)}
              />
              <InlineNotice icon={ExternalLink}>
                Você será direcionado ao parceiro para concluir sua reserva. O Easy Trip não
                processa pagamentos.
              </InlineNotice>
            </>
          ) : (
            <InlineNotice icon={ExternalLink} tone="warning">
              Esta oferta ainda não tem um parceiro vinculado para finalizar a reserva.
            </InlineNotice>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
