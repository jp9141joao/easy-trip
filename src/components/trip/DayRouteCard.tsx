import * as Linking from 'expo-linking';
import { ExternalLink, Map as MapIcon, Navigation } from 'lucide-react-native';
import { View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';

import { AppText, Button, GlassCard, useToast } from '@/components/ui';
import type { ItineraryItem } from '@/domain/types';
import {
  buildDayRoute,
  describeRouteDistance,
  externalRouteUrl,
  formatApproximateDistance,
  routeRegion,
  routeStopsLabel,
} from '@/domain/route';
import { useTheme } from '@/theme';

/**
 * A rota do dia (§18, §19).
 *
 * SÓ APARECE QUANDO TEM O QUE MOSTRAR
 *
 * Duas paradas com coordenada é o mínimo — uma parada só não é rota, é um
 * pino, e um mapa com um pino não acrescenta nada à linha que já está no
 * roteiro logo acima. Item sem coordenada continua no roteiro e simplesmente
 * não entra aqui (§17).
 *
 * A DISTÂNCIA É EM LINHA RETA, E O CARD DIZ ISSO
 *
 * Não há provedor de rotas no projeto. O número é Haversine entre os pontos, e
 * o texto é "≈ X km em linha reta entre os pontos" — nunca "X km de carro" e
 * nunca um tempo de deslocamento. Numa cidade europeia a diferença entre linha
 * reta e trajeto real passa de 30% com facilidade, e apresentar um como o outro
 * faria a pessoa perder o horário do museu.
 *
 * Quem tem o cálculo de verdade é o aplicativo de mapas do aparelho — daí o
 * botão que manda a rota inteira para lá, na mesma ordem do roteiro.
 */
export function DayRouteCard({
  items,
  date,
  onOpenFullMap,
}: {
  items: ItineraryItem[];
  date: string;
  onOpenFullMap?: () => void;
}) {
  const theme = useTheme();
  const toast = useToast();

  const route = buildDayRoute(items, date);
  if (!route) return null;

  const openExternal = async () => {
    try {
      await Linking.openURL(externalRouteUrl(route));
    } catch {
      toast.error('Não foi possível abrir o aplicativo de mapas.');
    }
  };

  return (
    <GlassCard style={{ gap: theme.spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        <Navigation size={16} color={theme.colors.primary} />
        <AppText variant="label" color="brand">
          Rota do dia
        </AppText>
      </View>

      <View
        style={{ height: 180, borderRadius: theme.radius.smallCard, overflow: 'hidden' }}
        accessible
        accessibilityLabel={`Mapa com ${route.stops.length} paradas, na ordem do roteiro.`}
      >
        <MapView
          provider={PROVIDER_DEFAULT}
          style={{ flex: 1 }}
          initialRegion={routeRegion(route)}
          pointerEvents="none"
        >
          {/*
            O traçado liga os pontos na ordem do ROTEIRO, não na ordem
            geográfica mais curta. Reordenar para encurtar a linha
            transformaria o mapa numa proposta de itinerário diferente do que
            está escrito logo acima — e os números dos marcadores deixariam de
            bater com a lista.
          */}
          <Polyline
            coordinates={route.stops.map((stop) => ({
              latitude: stop.latitude,
              longitude: stop.longitude,
            }))}
            strokeColor={theme.colors.primary}
            strokeWidth={3}
          />
          {route.stops.map((stop) => (
            <Marker
              key={stop.id}
              coordinate={{ latitude: stop.latitude, longitude: stop.longitude }}
              title={`${stop.index}. ${stop.title}`}
              description={stop.placeName}
            />
          ))}
        </MapView>
      </View>

      <View style={{ gap: theme.spacing.sm }}>
        {route.stops.map((stop, index) => (
          <View key={stop.id} style={{ gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
              <View
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 10,
                  backgroundColor: theme.colors.primarySoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <AppText variant="label" color="brand" style={{ fontSize: 10 }}>
                  {String(stop.index)}
                </AppText>
              </View>
              <AppText variant="bodySmall" numberOfLines={1} style={{ flex: 1 }}>
                {stop.startTime ? `${stop.startTime} · ${stop.title}` : stop.title}
              </AppText>
            </View>

            {index < route.legs.length ? (
              <AppText variant="caption" color="tertiary" style={{ marginLeft: 28 }}>
                {`↓ ${formatApproximateDistance(route.legs[index])}`}
              </AppText>
            ) : null}
          </View>
        ))}
      </View>

      <View style={{ gap: 2 }}>
        <AppText variant="bodySmall" weight="semibold">
          {describeRouteDistance(route)}
        </AppText>
        <AppText variant="caption" color="tertiary">
          {`${routeStopsLabel(route)} · a distância real de caminhada ou carro é maior`}
        </AppText>
      </View>

      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        {onOpenFullMap ? (
          <Button
            label="Ver mapa completo"
            variant="secondary"
            size="sm"
            icon={MapIcon}
            onPress={onOpenFullMap}
            style={{ flex: 1 }}
          />
        ) : null}
        <Button
          label="Abrir no Maps"
          variant="secondary"
          size="sm"
          icon={ExternalLink}
          onPress={() => void openExternal()}
          style={{ flex: 1 }}
        />
      </View>
    </GlassCard>
  );
}
