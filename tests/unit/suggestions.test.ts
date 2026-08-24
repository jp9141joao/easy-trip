import {
  MINIMUM_SUGGESTIONS,
  SUGGESTION_CATEGORIES,
  canRefreshSuggestions,
  findSimilar,
  formatDuration,
  generatedSuggestionSchema,
  normalizeGeneratedSuggestion,
  normalizeTitle,
} from '@/domain/suggestions';

/**
 * Sugestões (§39–§47, cenário 6 do §76).
 *
 * Dois compromissos são testados aqui acima de tudo:
 *  1. o modelo NÃO tem onde escrever preço, horário, nota ou URL (§41, §42);
 *  2. adicionar ao roteiro avisa quando já existe algo parecido (§46).
 */
describe('o que uma sugestão pode afirmar (§41)', () => {
  it('não existe campo para preço, nota, horário, disponibilidade ou URL', () => {
    const shape = Object.keys(generatedSuggestionSchema.shape);
    for (const proibido of ['price', 'rating', 'openingHours', 'availability', 'url', 'phone']) {
      expect(shape).not.toContain(proibido);
    }
  });

  it('campos inventados pelo modelo são descartados na leitura', () => {
    const parsed = generatedSuggestionSchema.safeParse({
      title: 'Museu do Louvre',
      category: 'atracoes',
      description: 'Um dos principais museus de Paris, com acervo enorme.',
      price: 'R$ 120',
      rating: 4.8,
      url: 'https://exemplo-malicioso.test',
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data).not.toHaveProperty('price');
    expect(parsed.data).not.toHaveProperty('rating');
    expect(parsed.data).not.toHaveProperty('url');
  });

  it('recusa categoria fora da lista', () => {
    const parsed = generatedSuggestionSchema.safeParse({
      title: 'X',
      category: 'compras-duty-free',
      description: 'Descrição suficientemente longa para passar.',
    });
    expect(parsed.success).toBe(false);
  });

  it('recusa coordenada fora do planeta', () => {
    const parsed = generatedSuggestionSchema.safeParse({
      title: 'X',
      category: 'lugares',
      description: 'Descrição suficientemente longa para passar.',
      latitude: 200,
      longitude: 2,
    });
    expect(parsed.success).toBe(false);
  });

  it('meia coordenada é descartada: não vira um ponto no Atlântico', () => {
    const normalizada = normalizeGeneratedSuggestion({
      title: 'X',
      category: 'lugares',
      description: 'Descrição suficientemente longa para passar.',
      latitude: 48.86,
    });
    expect(normalizada.latitude).toBeUndefined();
    expect(normalizada.longitude).toBeUndefined();
  });

  it('coordenada completa passa intacta', () => {
    const normalizada = normalizeGeneratedSuggestion({
      title: 'X',
      category: 'lugares',
      description: 'Descrição suficientemente longa para passar.',
      latitude: 48.86,
      longitude: 2.34,
    });
    expect(normalizada.latitude).toBe(48.86);
    expect(normalizada.longitude).toBe(2.34);
  });

  it('as seis categorias do produto', () => {
    expect([...SUGGESTION_CATEGORIES]).toEqual([
      'para_voce',
      'lugares',
      'atracoes',
      'gastronomia',
      'noite',
      'ar_livre',
    ]);
  });

  it('o mínimo por viagem é 3 (§41)', () => {
    expect(MINIMUM_SUGGESTIONS).toBe(3);
  });
});

describe('deduplicação ao adicionar ao roteiro (§46)', () => {
  const roteiro = [
    { id: 'i1', title: 'Museu do Louvre', latitude: 48.8606, longitude: 2.3376 },
    { id: 'i2', title: 'Jantar no Marais' },
  ];

  it('reconhece o mesmo lugar escrito de outro jeito', () => {
    expect(normalizeTitle('Museu do Louvre')).toBe(normalizeTitle('LOUVRE'));
    expect(findSimilar({ title: 'louvre' }, roteiro)?.id).toBe('i1');
  });

  it('reconhece o mesmo ponto com nome diferente, pela coordenada', () => {
    // "Pirâmide do Louvre" é outro nome, a 40 m do mesmo lugar.
    const encontrado = findSimilar(
      { title: 'Pirâmide de vidro', latitude: 48.8609, longitude: 2.3377 },
      roteiro,
    );
    expect(encontrado?.id).toBe('i1');
  });

  it('não confunde o café ao lado com o museu', () => {
    // ~1,5 km de distância: outro lugar.
    expect(
      findSimilar({ title: 'Café de Flore', latitude: 48.8542, longitude: 2.3320 }, roteiro),
    ).toBeUndefined();
  });

  it('nada parecido devolve nada — a adição segue sem interrupção', () => {
    expect(findSimilar({ title: 'Catacumbas de Paris' }, roteiro)).toBeUndefined();
  });
});

describe('limite de refresh (§43)', () => {
  const AGORA = new Date('2026-08-24T12:00:00.000Z');

  it('viagem sem geração anterior pode gerar', () => {
    expect(canRefreshSuggestions(undefined, AGORA)).toBe(true);
  });

  it('recusa um segundo refresh logo em seguida', () => {
    expect(canRefreshSuggestions('2026-08-24T11:00:00.000Z', AGORA)).toBe(false);
  });

  it('libera depois de seis horas', () => {
    expect(canRefreshSuggestions('2026-08-24T05:00:00.000Z', AGORA)).toBe(true);
  });

  it('marca d’água ilegível não bloqueia para sempre', () => {
    expect(canRefreshSuggestions('não é uma data', AGORA)).toBe(true);
  });
});

describe('duração', () => {
  it('mostra faixa em vez de número exato — passeio não é cronometrado', () => {
    expect(formatDuration(150)).toBe('2–3h');
    expect(formatDuration(120)).toBe('2h');
    expect(formatDuration(45)).toBe('45 min');
  });

  it('sem duração, nada é exibido', () => {
    expect(formatDuration(undefined)).toBeUndefined();
  });
});
