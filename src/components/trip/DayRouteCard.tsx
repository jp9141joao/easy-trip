import * as Linking from 'expo-linking';
import { ExternalLink, Map as MapIcon, Navigation } from 'lucide-react-native';
import { useMemo } from 'react';
import { View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';

import { AdaptiveButtonRow, AppText, Button, GlassCard, useToast } from '@/components/ui';
import type { ItineraryItem } from '@/domain/types';
import {
  buildDayRoute,
  describeRouteDistance,
  externalRouteUrl,
  formatApproximateDistance,
  routeRegion,
  routeStopsLabel,
  STRAIGHT_LINE_METHOD,
} from '@/domain/route';
import { formatClockTime } from '@/lib/date';
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
 *
 * POR QUE O CARD DEIXOU DE FICAR ESPREMIDO NO ANDROID
 *
 * Quatro medidas fixas competiam pela mesma largura de 280dp que sobra num
 * aparelho de 360dp, depois das margens da tela e do recuo do card:
 *
 * 1. o mapa tinha `height: 180` — quase dois terços da altura útil do card
 *    num aparelho estreito, e exatamente a mesma altura num tablet;
 * 2. horário e nome viviam num texto só, com `numberOfLines={1}`: um nome
 *    longo era cortado no meio, e a régua de horários não existia;
 * 3. o número da distância e a explicação do método tinham praticamente o
 *    mesmo peso da lista de paradas logo acima;
 * 4. os dois botões eram `flex: 1` numa fileira que não cabia — cada um ficava
 *    com cerca de 136dp e "Ver mapa completo" virava "Ver mapa co...".
 *
 * A correção é a mesma em todos: nada de altura ou largura de aparelho. O mapa
 * é uma PROPORÇÃO da largura do card, o nome ocupa o que sobra da linha
 * (`flex: 1` com `minWidth: 0`) enquanto número e horário nunca encolhem, e a
 * fileira de botões vira coluna quando os rótulos não cabem (§14).
 */

/**
 * O mapa acompanha a largura do card em vez de ter altura de aparelho. 16:9
 * dá leitura de rota sem tomar o card; o teto existe para o tablet, onde a
 * mesma proporção passaria de 400dp de mapa.
 */
const MAP_ASPECT_RATIO = 16 / 9;
const MAP_MAX_HEIGHT = 200;

/** Diâmetro do número da parada — bate com o marcador no mapa. */
const STOP_BULLET = 22;

/**
 * O que o rótulo mais largo ("Abrir no Maps") precisa com o ícone e o respiro
 * interno, com folga para quem aumenta o tamanho do texto no sistema. Abaixo
 * disso a coluna é o layout honesto — melhor dois botões inteiros empilhados
 * do que dois cortados lado a lado.
 */
const ACTION_MIN_WIDTH = 168;

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

  /*
   * Memorizado porque o card fica dentro da lista da Jornada: sem isto, cada
   * render da tela refazia o Haversine de todas as paradas e entregava um
   * array novo de coordenadas ao `Polyline`, que remontava o traçado à toa.
   */
  const route = useMemo(() => buildDayRoute(items, date), [items, date]);
  const region = useMemo(() => (route ? routeRegion(route) : null), [route]);
  const path = useMemo(
    () =>
      route?.stops.map((stop) => ({ latitude: stop.latitude, longitude: stop.longitude })) ?? [],
    [route],
  );

  if (!route || !region) return null;

  const openExternal = async () => {
    try {
      await Linking.openURL(externalRouteUrl(route));
    } catch {
      toast.error('Não foi possível abrir o aplicativo de mapas.');
    }
  };

  return (
    <GlassCard style={{ gap: theme.spacing.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        <Navigation size={16} color={theme.colors.primary} />
        <AppText variant="label" color="brand">
          Rota do dia
        </AppText>
      </View>

      <View
        testID="day-route-map"
        style={{
          width: '100%',
          aspectRatio: MAP_ASPECT_RATIO,
          maxHeight: MAP_MAX_HEIGHT,
          borderRadius: theme.radius.smallCard,
          overflow: 'hidden',
          backgroundColor: theme.colors.surfaceMuted,
        }}
        accessible
        accessibilityLabel={`Mapa com ${route.stops.length} paradas, na ordem do roteiro.`}
      >
        <MapView
          provider={PROVIDER_DEFAULT}
          style={{ flex: 1 }}
          initialRegion={region}
          pointerEvents="none"
        >
          {/*
            O traçado liga os pontos na ordem do ROTEIRO, não na ordem
            geográfica mais curta. Reordenar para encurtar a linha
            transformaria o mapa numa proposta de itinerário diferente do que
            está escrito logo acima — e os números dos marcadores deixariam de
            bater com a lista.
          */}
          <Polyline coordinates={path} strokeColor={theme.colors.primary} strokeWidth={3} />
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

      <View style={{ gap: theme.spacing.md }}>
        {route.stops.map((stop, index) => {
          const clock = formatClockTime(stop.startTime);
          return (
            <View key={stop.id} style={{ gap: theme.spacing.xs }}>
              {/*
                Três colunas com papéis diferentes: o número e o horário são
                largura de conteúdo e NÃO encolhem — some um deles e a lista
                deixa de bater com os marcadores do mapa. Quem cede é o nome,
                que fica com o resto da linha e quebra em até duas antes de
                reticenciar. `alignItems: 'flex-start'` para que um nome de
                duas linhas não desloque o número para o meio da altura.
              */}
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'flex-start',
                  gap: theme.spacing.sm,
                }}
              >
                <View
                  style={{
                    width: STOP_BULLET,
                    height: STOP_BULLET,
                    borderRadius: STOP_BULLET / 2,
                    backgroundColor: theme.colors.primarySoft,
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <AppText variant="label" color="brand" style={{ fontSize: 11 }}>
                    {String(stop.index)}
                  </AppText>
                </View>

                {clock ? (
                  <AppText
                    variant="bodySmall"
                    color="secondary"
                    mono
                    style={{ flexShrink: 0 }}
                  >
                    {clock}
                  </AppText>
                ) : null}

                <AppText variant="bodySmall" numberOfLines={2} style={{ flex: 1, minWidth: 0 }}>
                  {stop.title}
                </AppText>
              </View>

              {index < route.legs.length ? (
                <AppText
                  variant="caption"
                  color="tertiary"
                  style={{ marginLeft: STOP_BULLET + theme.spacing.sm }}
                >
                  {`↓ ${formatApproximateDistance(route.legs[index])}`}
                </AppText>
              ) : null}
            </View>
          );
        })}
      </View>

      {/*
        O total é o fecho da lista, não mais um item dela: separado por um
        filete, com o número em destaque moderado e o método logo ao lado, em
        texto secundário. Para o leitor de tela as duas partes voltam a ser uma
        frase só — "≈ 5,7 km em linha reta entre os pontos" —, que é como a
        informação tem de ser ouvida (§19).
      */}
      <View
        style={{
          gap: theme.spacing.xs,
          paddingTop: theme.spacing.md,
          borderTopWidth: 1,
          borderTopColor: theme.colors.border,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-end',
            flexWrap: 'wrap',
            gap: theme.spacing.xs,
          }}
          accessible
          accessibilityLabel={describeRouteDistance(route)}
        >
          <AppText variant="body" weight="semibold" mono>
            {formatApproximateDistance(route.totalDistanceKm)}
          </AppText>
          <AppText variant="bodySmall" color="secondary">
            {STRAIGHT_LINE_METHOD}
          </AppText>
        </View>
        <AppText variant="caption" color="tertiary">
          {`${routeStopsLabel(route)} · a distância real de caminhada ou carro é maior`}
        </AppText>
      </View>

      <AdaptiveButtonRow minItemWidth={ACTION_MIN_WIDTH}>
        {onOpenFullMap ? (
          <Button
            label="Mapa completo"
            accessibilityLabel="Ver o mapa completo da viagem"
            variant="secondary"
            size="sm"
            icon={MapIcon}
            fullWidth
            onPress={onOpenFullMap}
          />
        ) : null}
        <Button
          label="Abrir no Maps"
          accessibilityLabel="Abrir a rota do dia no aplicativo de mapas"
          variant="secondary"
          size="sm"
          icon={ExternalLink}
          fullWidth
          onPress={() => void openExternal()}
        />
      </AdaptiveButtonRow>
    </GlassCard>
  );
}
