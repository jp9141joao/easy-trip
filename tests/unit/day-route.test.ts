import type { ItineraryItem } from '@/domain/types';
import {
  buildDayRoute,
  describeRouteDistance,
  externalRouteUrl,
  formatApproximateDistance,
  haversineKm,
  routeRegion,
} from '@/domain/route';

/**
 * A rota do dia (§18, §19, cenário 3 do §73).
 *
 * O que estes testes protegem, acima de tudo, é a HONESTIDADE do número: a
 * distância é em linha reta, o texto diz isso, e a ordem dos marcadores é a do
 * roteiro — nunca a mais curta.
 */
const item = (over: Partial<ItineraryItem>): ItineraryItem => ({
  id: Math.random().toString(36).slice(2),
  tripId: 'trip-paris',
  date: '2026-08-24',
  type: 'atracao',
  title: 'Atividade',
  completed: false,
  sortOrder: 0,
  visibility: 'shared',
  ...over,
});

const LOUVRE = { latitude: 48.8606, longitude: 2.3376 };
const EIFFEL = { latitude: 48.8584, longitude: 2.2945 };
const MONTMARTRE = { latitude: 48.8867, longitude: 2.3431 };

describe('haversine', () => {
  it('mede a distância real entre dois pontos conhecidos de Paris', () => {
    // Louvre → Torre Eiffel: ~3,2 km em linha reta.
    const km = haversineKm(LOUVRE, EIFFEL);
    expect(km).toBeGreaterThan(3);
    expect(km).toBeLessThan(3.6);
  });

  it('mesma coordenada é distância zero', () => {
    expect(haversineKm(LOUVRE, LOUVRE)).toBeCloseTo(0, 6);
  });

  it('é simétrica', () => {
    expect(haversineKm(LOUVRE, MONTMARTRE)).toBeCloseTo(haversineKm(MONTMARTRE, LOUVRE), 9);
  });
});

describe('buildDayRoute', () => {
  it('não desenha rota com menos de duas paradas com coordenada', () => {
    expect(buildDayRoute([item({ ...LOUVRE })], '2026-08-24')).toBeNull();
    expect(buildDayRoute([], '2026-08-24')).toBeNull();
  });

  it('ignora item sem coordenada, mas ele continua sendo um item válido', () => {
    const items = [
      item({ title: 'Louvre', startTime: '09:00', ...LOUVRE }),
      item({ title: 'Almoço sem endereço', startTime: '13:00' }),
      item({ title: 'Torre Eiffel', startTime: '16:00', ...EIFFEL }),
    ];
    const route = buildDayRoute(items, '2026-08-24')!;
    expect(route.stops).toHaveLength(2);
    expect(route.stops.map((stop) => stop.title)).toEqual(['Louvre', 'Torre Eiffel']);
  });

  it('mantém a ORDEM DO ROTEIRO, não a geograficamente mais curta', () => {
    // Montmartre às 13h fica entre Louvre e Eiffel na agenda, embora um
    // caminho mais curto passasse por Eiffel antes. O mapa segue a agenda.
    const items = [
      item({ title: 'Louvre', startTime: '09:00', ...LOUVRE }),
      item({ title: 'Montmartre', startTime: '13:00', ...MONTMARTRE }),
      item({ title: 'Torre Eiffel', startTime: '16:00', ...EIFFEL }),
    ];
    const route = buildDayRoute(items, '2026-08-24')!;

    expect(route.stops.map((stop) => stop.title)).toEqual([
      'Louvre',
      'Montmartre',
      'Torre Eiffel',
    ]);
    expect(route.stops.map((stop) => stop.index)).toEqual([1, 2, 3]);
  });

  it('só considera o dia pedido', () => {
    const items = [
      item({ date: '2026-08-24', ...LOUVRE }),
      item({ date: '2026-08-24', ...EIFFEL }),
      item({ date: '2026-08-25', ...MONTMARTRE }),
    ];
    expect(buildDayRoute(items, '2026-08-24')!.stops).toHaveLength(2);
  });

  it('soma as pernas e devolve distância maior que zero (cenário §73)', () => {
    const items = [
      item({ title: 'Louvre', startTime: '09:00', ...LOUVRE }),
      item({ title: 'Torre Eiffel', startTime: '13:00', ...EIFFEL }),
      item({ title: 'Montmartre', startTime: '17:00', ...MONTMARTRE }),
    ];
    const route = buildDayRoute(items, '2026-08-24')!;

    expect(route.legs).toHaveLength(2);
    expect(route.totalDistanceKm).toBeGreaterThan(0);
    expect(route.totalDistanceKm).toBeCloseTo(route.legs[0] + route.legs[1], 6);
  });

  it('a rota se declara aproximada — a tela lê a flag, não adivinha', () => {
    const route = buildDayRoute(
      [item({ ...LOUVRE }), item({ ...EIFFEL })],
      '2026-08-24',
    )!;
    expect(route.approximate).toBe(true);
  });

  it('item sem horário vem depois de quem tem, e a ordem é estável', () => {
    const items = [
      item({ title: 'Sem horário B', sortOrder: 1, ...MONTMARTRE }),
      item({ title: 'Com horário', startTime: '09:00', sortOrder: 5, ...LOUVRE }),
      item({ title: 'Sem horário A', sortOrder: 0, ...EIFFEL }),
    ];
    const route = buildDayRoute(items, '2026-08-24')!;
    expect(route.stops.map((s) => s.title)).toEqual([
      'Com horário',
      'Sem horário A',
      'Sem horário B',
    ]);
  });
});

describe('como a distância é apresentada (§19)', () => {
  it('sempre com "≈" — nunca como um valor exato', () => {
    expect(formatApproximateDistance(7.42)).toBe('≈ 7,4 km');
  });

  it('abaixo de 1 km vira metros, porque isso é uma caminhada', () => {
    expect(formatApproximateDistance(0.85)).toBe('≈ 850 m');
  });

  it('a frase diz o método, e NUNCA chama isto de distância de carro', () => {
    const route = buildDayRoute([item({ ...LOUVRE }), item({ ...EIFFEL })], '2026-08-24')!;
    const frase = describeRouteDistance(route);

    expect(frase).toContain('em linha reta');
    expect(frase.toLowerCase()).not.toContain('de carro');
    expect(frase.toLowerCase()).not.toContain('minutos');
    expect(frase.toLowerCase()).not.toContain('caminhada');
  });

  it('valor inválido não vira número inventado', () => {
    expect(formatApproximateDistance(Number.NaN)).toBe('—');
    expect(formatApproximateDistance(-1)).toBe('—');
  });
});

describe('enquadramento e navegação externa', () => {
  it('a região tem folga mínima — um dia no mesmo quarteirão não abre no zoom máximo', () => {
    const route = buildDayRoute(
      [
        item({ latitude: 48.8606, longitude: 2.3376 }),
        item({ latitude: 48.8607, longitude: 2.3377 }),
      ],
      '2026-08-24',
    )!;
    const region = routeRegion(route);
    expect(region.latitudeDelta).toBeGreaterThanOrEqual(0.02);
    expect(region.longitudeDelta).toBeGreaterThanOrEqual(0.02);
  });

  it('a URL externa leva todas as paradas, na ordem do roteiro', () => {
    const route = buildDayRoute(
      [
        item({ title: 'A', startTime: '09:00', ...LOUVRE }),
        item({ title: 'B', startTime: '12:00', ...MONTMARTRE }),
        item({ title: 'C', startTime: '17:00', ...EIFFEL }),
      ],
      '2026-08-24',
    )!;

    const url = new URL(externalRouteUrl(route));
    expect(url.searchParams.get('origin')).toBe('48.8606,2.3376');
    expect(url.searchParams.get('destination')).toBe('48.8584,2.2945');
    expect(url.searchParams.get('waypoints')).toBe('48.8867,2.3431');
  });

  it('rota de dois pontos não inventa waypoint', () => {
    const route = buildDayRoute([item({ ...LOUVRE }), item({ ...EIFFEL })], '2026-08-24')!;
    expect(new URL(externalRouteUrl(route)).searchParams.get('waypoints')).toBeNull();
  });
});
