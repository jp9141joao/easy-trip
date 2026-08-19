import { zodResolver } from '@hookform/resolvers/zod';
import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import {
  CalendarPlus,
  ChevronLeft,
  Clock,
  ExternalLink,
  Heart,
  MapPin,
  Phone,
  Sparkles,
  Star,
} from 'lucide-react-native';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Markdown } from '@/components/Markdown';
import {
  AppImage,
  AppText,
  Badge,
  BottomSheet,
  Button,
  Chip,
  ChipRow,
  ErrorState,
  GlassCard,
  IconButton,
  InfoRow,
  InlineNotice,
  SectionHeader,
  SkeletonCard,
  TextField,
  useToast,
} from '@/components/ui';
import { reservationRequestSchema, type ReservationRequestInput } from '@/domain/schemas';
import type { Place } from '@/domain/types';
import { usePlace, usePlaceFavorites, useReservations } from '@/hooks/useContent';
import { useCurrentTrip } from '@/hooks/useTrips';
import { formatMoney } from '@/lib/currency';
import { PLACE_TYPE_LABEL } from '@/lib/labels';
import { aiService } from '@/services/ai';
import { useTheme } from '@/theme';

export default function PlaceDetailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { placeId } = useLocalSearchParams<{ placeId: string }>();

  const { data: place, isLoading, isError, refetch } = usePlace(placeId);
  const { isFavorite, toggle } = usePlaceFavorites();
  const { trip } = useCurrentTrip();
  const { request } = useReservations();

  const [reserveOpen, setReserveOpen] = useState(false);
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background, padding: theme.spacing.screen, paddingTop: 100 }}>
        <SkeletonCard lines={6} height={320} />
      </View>
    );
  }

  if (isError || !place) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background, padding: theme.spacing.screen, paddingTop: 100 }}>
        <GlassCard>
          <ErrorState
            title="Lugar não encontrado"
            message="Este estabelecimento pode não estar mais no diretório."
            onRetry={() => (isError ? void refetch() : router.replace('/places'))}
            retryLabel={isError ? 'Tentar novamente' : 'Ver lugares'}
          />
        </GlassCard>
      </View>
    );
  }

  const favorite = isFavorite(place.id);

  const openMap = async () => {
    const query =
      typeof place.latitude === 'number' && typeof place.longitude === 'number'
        ? `${place.latitude},${place.longitude}`
        : encodeURIComponent(`${place.name} ${place.city}`);
    const url = Platform.select({
      ios: `maps://?q=${query}`,
      android: `geo:0,0?q=${query}`,
      default: `https://www.google.com/maps/search/?api=1&query=${query}`,
    });
    try {
      await Linking.openURL(url);
    } catch {
      await WebBrowser.openBrowserAsync(
        `https://www.google.com/maps/search/?api=1&query=${query}`,
      );
    }
  };

  const call = async () => {
    if (!place.phone) return;
    try {
      await Linking.openURL(`tel:${place.phone.replace(/\s/g, '')}`);
    } catch {
      toast.error('Não foi possível iniciar a chamada.');
    }
  };

  /** Place-aware assistant (§53) — real service call, no hardcoded answers. */
  const askAI = async (question: string) => {
    setAiLoading(true);
    setAiAnswer(null);
    try {
      const reply = await aiService.send({
        prompt: `${question}\n\nEstabelecimento: ${place.name} (${PLACE_TYPE_LABEL[place.type]}) em ${place.city}, ${place.country}.`,
        context: null,
        history: [],
      });
      setAiAnswer(reply.content);
    } catch {
      toast.error('Não foi possível consultar o assistente agora.');
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + theme.spacing['4xl'] }}
      >
        <View>
          <AppImage
            uri={place.imageUrl}
            style={{ height: 300 + insets.top, width: '100%' }}
            fallbackLabel={place.name}
            overlay
          />

          <View
            style={{
              position: 'absolute',
              top: insets.top + theme.spacing.sm,
              left: theme.spacing.screen,
              right: theme.spacing.screen,
              flexDirection: 'row',
              justifyContent: 'space-between',
            }}
          >
            <IconButton
              icon={ChevronLeft}
              accessibilityLabel="Voltar"
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/places'))}
              background="glass"
              color={theme.colors.textOnImage}
            />
            <IconButton
              icon={Heart}
              accessibilityLabel={favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
              onPress={() => toggle.mutate({ placeId: place.id, favorite: !favorite })}
              background="glass"
              color={favorite ? theme.colors.accent : theme.colors.textOnImage}
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
              <Badge label={PLACE_TYPE_LABEL[place.type]} tone="brand" />
              {place.rating ? (
                <Badge label={`${place.rating.toFixed(1)} ★`} tone="warning" icon={Star} />
              ) : null}
            </View>
            <AppText variant="h1" color="onImage" weight="bold" numberOfLines={2}>
              {place.name}
            </AppText>
            <AppText variant="bodySmall" color="onImage">
              {place.city}, {place.country}
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
          {place.description ? (
            <View>
              <SectionHeader title="Sobre" />
              <AppText variant="body" color="secondary">
                {place.description}
              </AppText>
            </View>
          ) : null}

          <View>
            <SectionHeader title="Informações" />
            <GlassCard>
              {place.address ? (
                <InfoRow
                  icon={MapPin}
                  label="Endereço"
                  value={place.address}
                  onPress={() => void openMap()}
                  accessibilityHint="Abre no aplicativo de mapas"
                />
              ) : null}
              {place.phone ? (
                <InfoRow
                  icon={Phone}
                  label="Telefone"
                  value={place.phone}
                  onPress={() => void call()}
                  accessibilityHint="Inicia uma chamada"
                />
              ) : null}
              {place.averagePrice && place.currency ? (
                <InfoRow
                  label="Preço médio"
                  value={formatMoney(place.averagePrice, place.currency)}
                />
              ) : null}
              {place.priceLevel ? (
                <InfoRow label="Faixa de preço" value={'$'.repeat(place.priceLevel)} />
              ) : null}
            </GlassCard>
          </View>

          {place.amenities && place.amenities.length > 0 ? (
            <View>
              <SectionHeader title="Comodidades" />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
                {place.amenities.map((amenity) => (
                  <Badge key={amenity} label={amenity} tone="neutral" />
                ))}
              </View>
            </View>
          ) : null}

          {place.openingHours && place.openingHours.length > 0 ? (
            <View>
              <SectionHeader title="Horários" />
              <GlassCard>
                <View style={{ gap: theme.spacing.sm }}>
                  {place.openingHours.map((hours) => (
                    <View
                      key={hours}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}
                    >
                      <Clock size={14} color={theme.colors.textTertiary} />
                      <AppText variant="bodySmall" color="secondary">
                        {hours}
                      </AppText>
                    </View>
                  ))}
                </View>
                <InlineNotice tone="warning">
                  Horários podem mudar sem aviso. Confirme com o estabelecimento antes de ir.
                </InlineNotice>
              </GlassCard>
            </View>
          ) : null}

          {/* ------------------------------ Place AI --------------------------- */}
          <View>
            <SectionHeader
              title="Pergunte ao assistente"
              subtitle={aiService.kind === 'gemini' ? 'Gemini via backend' : 'Modo demonstração'}
            />
            <View style={{ marginHorizontal: -theme.spacing.screen, paddingLeft: theme.spacing.screen }}>
              <ChipRow>
                <Chip
                  label="Cardápio"
                  icon={Sparkles}
                  onPress={() => void askAI('O que costuma ter no cardápio deste lugar?')}
                />
                <Chip
                  label="Dresscode"
                  icon={Sparkles}
                  onPress={() => void askAI('Qual o dresscode adequado para este lugar?')}
                />
                <Chip
                  label="Melhor horário"
                  icon={Sparkles}
                  onPress={() => void askAI('Qual o melhor horário para visitar e evitar filas?')}
                />
              </ChipRow>
            </View>

            {aiLoading ? (
              <GlassCard style={{ marginTop: theme.spacing.md }}>
                <AppText variant="bodySmall" color="secondary">
                  Consultando o assistente…
                </AppText>
              </GlassCard>
            ) : aiAnswer ? (
              <GlassCard style={{ marginTop: theme.spacing.md }}>
                <Markdown content={aiAnswer} variant="bodySmall" />
              </GlassCard>
            ) : null}
          </View>

          {/* ----------------------------- Actions ---------------------------- */}
          <View style={{ gap: theme.spacing.md }}>
            <Button
              label="Abrir no mapa"
              icon={MapPin}
              variant="secondary"
              fullWidth
              onPress={() => void openMap()}
            />

            {place.type !== 'attraction' ? (
              <Button
                label="Solicitar reserva"
                icon={CalendarPlus}
                fullWidth
                size="lg"
                onPress={() => setReserveOpen(true)}
              />
            ) : null}

            {place.partnerUrl ? (
              <Button
                label="Ver no parceiro"
                icon={ExternalLink}
                variant="secondary"
                fullWidth
                onPress={() => void WebBrowser.openBrowserAsync(place.partnerUrl!)}
              />
            ) : null}
          </View>

          {/* §52 — we never invent reviews. */}
          <InlineNotice>
            O Easy Trip ainda não exibe avaliações de usuários. As notas mostradas vêm do cadastro do
            diretório e não de avaliações da comunidade.
          </InlineNotice>
        </View>
      </ScrollView>

      <ReservationSheet
        visible={reserveOpen}
        place={place}
        tripId={trip?.id}
        onClose={() => setReserveOpen(false)}
        onDone={() => {
          setReserveOpen(false);
          toast.success('Solicitação enviada. O estabelecimento ainda precisa confirmar.');
        }}
        request={request}
      />
    </View>
  );
}

/* ---------------------------- reservation request -------------------------- */

function ReservationSheet({
  visible,
  place,
  tripId,
  onClose,
  onDone,
  request,
}: {
  visible: boolean;
  place: Place;
  tripId?: string;
  onClose: () => void;
  onDone: () => void;
  request: ReturnType<typeof useReservations>['request'];
}) {
  const theme = useTheme();
  const toast = useToast();

  const { control, handleSubmit, reset, formState } = useForm<ReservationRequestInput>({
    resolver: zodResolver(reservationRequestSchema),
    defaultValues: { requestedFor: '', partySize: 2, notes: '' },
  });

  const onSubmit = async (values: ReservationRequestInput) => {
    try {
      await request.mutateAsync({
        placeId: place.id,
        placeName: place.name,
        requestedFor: values.requestedFor,
        partySize: values.partySize,
        notes: values.notes,
        tripId,
      });
      reset();
      onDone();
    } catch {
      toast.error('Não foi possível enviar a solicitação. Tente novamente.');
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={`Reserva em ${place.name}`}
      subtitle="Enviaremos sua solicitação ao estabelecimento"
    >
      <View style={{ gap: theme.spacing.lg }}>
        {/* The core honesty rule of §54. */}
        <InlineNotice icon={CalendarPlus} tone="warning">
          Isto é uma solicitação, não uma reserva confirmada. Você receberá a confirmação somente
          após o estabelecimento responder.
        </InlineNotice>

        <Controller
          control={control}
          name="requestedFor"
          render={({ field, fieldState }) => (
            <TextField
              label="Data e horário desejados"
              placeholder="Ex.: 20/09 às 20h"
              value={field.value}
              onChangeText={field.onChange}
              error={fieldState.error?.message}
              required
            />
          )}
        />

        <Controller
          control={control}
          name="partySize"
          render={({ field, fieldState }) => (
            <TextField
              label="Quantas pessoas"
              placeholder="2"
              value={field.value ? String(field.value) : ''}
              onChangeText={(text) => field.onChange(Number(text.replace(/\D/g, '')) || 0)}
              error={fieldState.error?.message}
              keyboardType="number-pad"
              required
            />
          )}
        />

        <Controller
          control={control}
          name="notes"
          render={({ field, fieldState }) => (
            <TextField
              label="Observações"
              placeholder="Restrições alimentares, ocasião especial…"
              value={field.value}
              onChangeText={field.onChange}
              error={fieldState.error?.message}
              multiline
            />
          )}
        />

        <Button
          label="Enviar solicitação"
          size="lg"
          fullWidth
          loading={formState.isSubmitting || request.isPending}
          onPress={handleSubmit(onSubmit)}
          haptic
        />
      </View>
    </BottomSheet>
  );
}
