/**
 * Rota do dia: ordem das paradas, distância e o que se pode afirmar sobre ela.
 *
 * HONESTIDADE SOBRE A DISTÂNCIA (§19)
 *
 * O projeto não tem provedor de rotas. Não há Directions API, não há OSRM, não
 * há nada que saiba de ruas, mão única, pedágio ou trânsito. O que existe é a
 * distância em linha reta entre dois pares de coordenadas — a fórmula de
 * Haversine, que é exata para o que ela mede e não mede caminho nenhum.
 *
 * Então é isso que a tela diz: "≈ 7,4 km em linha reta". Nunca "7,4 km de
 * carro", nunca "23 minutos". A diferença entre linha reta e trajeto real numa
 * cidade europeia passa de 30% com facilidade, e um número desses apresentado
 * como distância de carro faria a pessoa perder o horário do Louvre.
 *
 * O botão "Abrir rota no Maps" existe justamente por isso: quem tem o cálculo
 * de verdade é o aplicativo de mapas do aparelho, e mandar a pessoa para lá é
 * mais útil do que fingir que temos a resposta.
 */

import type { ItineraryItem } from './types';

/** Raio médio da Terra, em quilômetros. */
const EARTH_RADIUS_KM = 6371;

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface RouteStop extends Coordinates {
  id: string;
  /** Posição no dia, começando em 1 — é o número que aparece no marcador. */
  index: number;
  title: string;
  placeName?: string;
  /** HH:mm, quando o item tem horário. */
  startTime?: string;
}

export interface DayRoute {
  date: string;
  stops: RouteStop[];
  /** Soma das distâncias em linha reta entre paradas consecutivas, em km. */
  totalDistanceKm: number;
  /** Distância entre cada par consecutivo. `legs.length === stops.length - 1`. */
  legs: number[];
  /**
   * A rota é sempre aproximada nesta fase. O campo existe para que a tela não
   * precise saber disso — ela lê a flag e escolhe o texto — e para que, no dia
   * em que houver provedor de rotas, só esta linha mude.
   */
  approximate: true;
}

/**
 * Distância em linha reta entre dois pontos, em quilômetros.
 *
 * Haversine e não a fórmula plana: a diferença é pequena em 5 km e grande o
 * bastante para importar quando o dia inclui um bate-volta a Versalhes.
 */
export function haversineKm(from: Coordinates, to: Coordinates): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;

  const dLat = toRad(to.latitude - from.latitude);
  const dLon = toRad(to.longitude - from.longitude);
  const lat1 = toRad(from.latitude);
  const lat2 = toRad(to.latitude);

  const a =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function hasCoordinates(
  item: Pick<ItineraryItem, 'latitude' | 'longitude'>,
): item is Pick<ItineraryItem, 'latitude' | 'longitude'> & Coordinates {
  return typeof item.latitude === 'number' && typeof item.longitude === 'number';
}

/**
 * Monta a rota de um dia a partir dos itens do roteiro.
 *
 * A ORDEM É A DO ROTEIRO, e não a ordem geográfica mais curta. Isso é uma
 * decisão, não uma limitação: quem montou o dia decidiu almoçar no Marais entre
 * o Louvre e a Torre Eiffel, e reordenar as paradas para encurtar o traçado
 * transformaria o mapa numa proposta de itinerário diferente do que está no
 * roteiro logo acima. Os números no marcador têm de bater com a lista.
 *
 * Item sem coordenada não entra na rota, e isso não o invalida (§17): ele
 * continua no roteiro, com horário e título, apenas não é desenhável. Devolve
 * `null` com menos de duas paradas — uma parada só não é rota, é um pino.
 */
export function buildDayRoute(items: ItineraryItem[], date: string): DayRoute | null {
  const ordered = items
    .filter((item) => item.date === date)
    .filter(hasCoordinates)
    .sort(compareItineraryOrder);

  if (ordered.length < 2) return null;

  const stops: RouteStop[] = ordered.map((item, position) => ({
    id: item.id,
    index: position + 1,
    title: item.title,
    placeName: item.placeName,
    startTime: item.startTime,
    latitude: item.latitude as number,
    longitude: item.longitude as number,
  }));

  const legs: number[] = [];
  for (let i = 1; i < stops.length; i += 1) {
    legs.push(haversineKm(stops[i - 1], stops[i]));
  }

  return {
    date,
    stops,
    legs,
    totalDistanceKm: legs.reduce((total, leg) => total + leg, 0),
    approximate: true,
  };
}

/**
 * A mesma ordem que a tela de Jornada usa: horário primeiro, `sortOrder` para
 * quem não tem horário, título como desempate final.
 *
 * O desempate por título existe para a ordem ser estável. Sem ele, dois itens
 * sem horário e com o mesmo `sortOrder` podiam trocar de posição entre um
 * render e outro — e os números do mapa dançariam sozinhos.
 */
export function compareItineraryOrder(a: ItineraryItem, b: ItineraryItem): number {
  if (a.startTime && b.startTime && a.startTime !== b.startTime) {
    return a.startTime < b.startTime ? -1 : 1;
  }
  if (a.startTime && !b.startTime) return -1;
  if (!a.startTime && b.startTime) return 1;
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.title.localeCompare(b.title, 'pt-BR');
}

/**
 * "≈ 7,4 km" / "≈ 850 m".
 *
 * O `≈` não é enfeite: ele é a parte do texto que impede a leitura errada.
 * Abaixo de 1 km a unidade vira metros porque "0,8 km" numa cidade é uma
 * caminhada, e escrever em metros deixa isso óbvio.
 */
export function formatApproximateDistance(km: number): string {
  if (!Number.isFinite(km) || km < 0) return '—';
  if (km < 1) return `≈ ${Math.round(km * 1000)} m`;
  return `≈ ${km.toFixed(1).replace('.', ',')} km`;
}

/**
 * O método, por extenso. É a metade da frase que impede a leitura errada, e
 * mora aqui — e não na tela — porque o card mostra o número e o método em
 * tipografias diferentes: separados no visual, a mesma frase para o leitor de
 * tela e para `describeRouteDistance`.
 */
export const STRAIGHT_LINE_METHOD = 'em linha reta entre os pontos';

/**
 * A frase completa que acompanha o mapa. Diz o método, não só o número.
 */
export function describeRouteDistance(route: DayRoute): string {
  return `${formatApproximateDistance(route.totalDistanceKm)} ${STRAIGHT_LINE_METHOD}`;
}

export function routeStopsLabel(route: DayRoute): string {
  return `${route.stops.length} paradas`;
}

/**
 * A região que enquadra todas as paradas, com uma folga proporcional.
 *
 * A folga é multiplicativa (1,4×) e tem um piso: sem o piso, um dia inteiro no
 * mesmo quarteirão produziria um delta perto de zero e o mapa abriria no zoom
 * máximo, mostrando o interior de um prédio.
 */
export function routeRegion(route: DayRoute) {
  const lats = route.stops.map((s) => s.latitude);
  const lngs = route.stops.map((s) => s.longitude);

  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * 1.4, 0.02),
    longitudeDelta: Math.max((maxLng - minLng) * 1.4, 0.02),
  };
}

/**
 * URL de navegação externa, com todas as paradas na ordem do roteiro.
 *
 * Google Maps aceita `waypoints` no formato universal, que abre o aplicativo
 * nativo quando ele está instalado e o site quando não está. É de propósito
 * que não há bifurcação por plataforma aqui: um `maps://` no iOS não aceita
 * paradas intermediárias, e cair para uma rota de dois pontos silenciosamente
 * daria uma rota diferente da que a tela acabou de mostrar.
 */
/**
 * "Como chegar" para UM ponto (§21 do handoff).
 *
 * Separado de `externalRouteUrl` porque a pergunta é outra: ali é "faça a rota
 * do meu dia", aqui é "me leve até aqui, de onde eu estiver". O aplicativo de
 * mapas resolve a origem sozinho, e é justamente por isso que ele existe — nós
 * não temos provedor de rotas e não vamos fingir que temos.
 *
 * O DESTINO É A COORDENADA, E O NOME É SÓ RÓTULO
 *
 * `destination` leva "lat,lng" e não o nome do lugar: um nome pode resolver
 * para o restaurante homônimo do outro lado da cidade, e a coordenada é a que
 * a pessoa marcou no mapa. `destination_place_id` não existe aqui porque não
 * temos id do Google — inventar um levaria a pessoa a outro lugar.
 *
 * `travelmode` fica de fora de propósito: quem escolhe entre andar, dirigir e
 * pegar transporte é quem está na rua, e chutar isso do lado de cá trocaria a
 * escolha da pessoa por um palpite nosso.
 *
 * O esquema `https://www.google.com/maps/...` é universal: no Android com o
 * Google Maps instalado o próprio sistema abre o aplicativo; sem ele, abre o
 * navegador. Um esquema nativo (`geo:` ou `comgooglemaps:`) falharia no
 * aparelho que não tivesse aquele app exato instalado.
 */
export function directionsUrl(
  destination: Coordinates,
  label?: string,
): string {
  const params = new URLSearchParams({
    api: '1',
    destination: `${destination.latitude},${destination.longitude}`,
  });
  // O rótulo é o que o mapa mostra no pino de destino. Vai depois da
  // coordenada e nunca no lugar dela.
  if (label?.trim()) params.set('query', label.trim());
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function externalRouteUrl(route: DayRoute): string {
  const point = (stop: RouteStop) => `${stop.latitude},${stop.longitude}`;
  const origin = point(route.stops[0]);
  const destination = point(route.stops[route.stops.length - 1]);
  const waypoints = route.stops.slice(1, -1).map(point).join('|');

  const params = new URLSearchParams({
    api: '1',
    origin,
    destination,
    travelmode: 'transit',
  });
  if (waypoints) params.set('waypoints', waypoints);

  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
