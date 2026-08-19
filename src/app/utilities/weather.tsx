import { useRouter } from 'expo-router';
import {
  CloudSun,
  Droplets,
  MapPin,
  RefreshCw,
  Thermometer,
  Wind,
} from 'lucide-react-native';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AppHeader,
  AppText,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  GlassCard,
  InlineNotice,
  SectionHeader,
  SkeletonCard,
  StatCard,
} from '@/components/ui';
import { AuroraBackground } from '@/components/ui/Surface';
import { useCurrentTrip } from '@/hooks/useTrips';
import { useTripWeather } from '@/hooks/useWeather';
import { formatRelativeTime, formatShortDate } from '@/lib/date';
import { useTheme } from '@/theme';

/**
 * Weather for the active trip's destination (§62).
 *
 * Nothing here says "tempo real" unless it was actually just fetched: the card
 * always states its source and when it was updated, and a cached reading is
 * labelled "Atualizado há …" instead of pretending to be live.
 */
export default function WeatherScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { trip } = useCurrentTrip();
  const { data, isLoading, isError, refetch, isRefetching } = useTripWeather(trip);

  const hasCoordinates = typeof trip?.latitude === 'number' && typeof trip?.longitude === 'number';

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AuroraBackground />

      <View style={{ paddingHorizontal: theme.spacing.screen }}>
        <AppHeader
          label="Utilidades"
          title="Clima"
          subtitle={trip ? `${trip.destinationCity}, ${trip.destinationCountry}` : undefined}
          showBack
        />
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.screen,
          paddingBottom: insets.bottom + theme.spacing['3xl'],
          gap: theme.spacing.lg,
        }}
      >
        {!trip ? (
          <GlassCard>
            <EmptyState
              icon={CloudSun}
              title="Nenhuma viagem ativa"
              message="Selecione ou crie uma viagem para ver o clima do destino."
              actionLabel="Ver viagens"
              onAction={() => router.replace('/(tabs)/trips')}
            />
          </GlassCard>
        ) : !hasCoordinates ? (
          <GlassCard>
            <EmptyState
              icon={MapPin}
              title="Destino sem coordenadas"
              message="Esta viagem foi criada sem localização geográfica, então não é possível buscar a previsão. Edite a viagem e selecione o destino na busca."
              actionLabel="Editar viagem"
              onAction={() => router.push(`/trip/${trip.id}/edit`)}
            />
          </GlassCard>
        ) : isLoading ? (
          <SkeletonCard lines={5} height={260} />
        ) : isError || !data ? (
          <GlassCard>
            <ErrorState
              message="Não foi possível carregar o clima. Verifique sua conexão e tente novamente."
              onRetry={() => void refetch()}
            />
          </GlassCard>
        ) : (
          <>
            {/* Current conditions */}
            <GlassCard elevation="md">
              <View style={{ gap: theme.spacing.lg }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                  <MapPin size={16} color={theme.colors.textSecondary} />
                  <AppText variant="body" weight="semibold" style={{ flex: 1 }}>
                    {data.city}
                  </AppText>
                  {data.stale ? <Badge label="Cache" tone="warning" /> : <Badge label="Atualizado" tone="success" />}
                </View>

                <View style={{ alignItems: 'center', gap: 2 }}>
                  <AppText variant="display" mono weight="bold" style={{ fontSize: 56, lineHeight: 62 }}>
                    {data.now.temperature}°
                  </AppText>
                  <AppText variant="body" color="secondary">
                    {data.now.description}
                  </AppText>
                  <AppText variant="caption" color="tertiary">
                    Sensação de {data.now.apparentTemperature}°
                  </AppText>
                </View>

                <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
                  <StatCard
                    label="Umidade"
                    value={`${data.now.humidity}%`}
                    icon={Droplets}
                    tone="brand"
                  />
                  <StatCard
                    label="Vento"
                    value={`${data.now.windSpeed} km/h`}
                    icon={Wind}
                    tone="neutral"
                  />
                  <StatCard
                    label="Sensação"
                    value={`${data.now.apparentTemperature}°`}
                    icon={Thermometer}
                    tone="accent"
                  />
                </View>
              </View>
            </GlassCard>

            {/* Provenance — required by §62 and CA-07 */}
            <InlineNotice icon={RefreshCw} tone={data.stale ? 'warning' : 'info'}>
              {data.stale
                ? `Sem conexão no momento. Mostrando a última leitura, atualizada ${formatRelativeTime(data.updatedAt)}.`
                : `Fonte: ${data.source} · Atualizado ${formatRelativeTime(data.updatedAt)}.`}
            </InlineNotice>

            {data.forecast.length > 0 ? (
              <View>
                <SectionHeader title="Próximos dias" />
                <GlassCard>
                  <View style={{ gap: theme.spacing.md }}>
                    {data.forecast.map((day) => (
                      <View
                        key={day.date}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: theme.spacing.md,
                        }}
                      >
                        <AppText variant="bodySmall" style={{ width: 84 }}>
                          {formatShortDate(day.date)}
                        </AppText>
                        <AppText variant="caption" color="secondary" style={{ flex: 1 }} numberOfLines={1}>
                          {day.description}
                        </AppText>
                        <AppText variant="bodySmall" mono color="secondary">
                          {day.min}°
                        </AppText>
                        <AppText variant="bodySmall" mono weight="bold">
                          {day.max}°
                        </AppText>
                      </View>
                    ))}
                  </View>
                </GlassCard>
              </View>
            ) : null}

            <Button
              label="Atualizar agora"
              icon={RefreshCw}
              variant="secondary"
              fullWidth
              loading={isRefetching}
              onPress={() => void refetch()}
            />
          </>
        )}
      </ScrollView>
    </View>
  );
}
