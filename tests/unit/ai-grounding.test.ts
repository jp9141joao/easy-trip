import { groundPlaceDraft } from '@/domain/aiGrounding';
import { generatedPlaceDraftSchema, type GeneratedPlaceDraft } from '@/domain/schemas';

/**
 * A IA não inventa fatos sobre estabelecimentos reais (§22, §58, §64, §65).
 *
 * Este é o teste que o §65 chama de obrigatório, e é o mais importante do
 * conjunto: um endereço ou telefone errado publicado sobre um hotel que existe
 * é dano real, não erro de conteúdo.
 *
 * Duas barreiras são verificadas separadamente, porque falham por motivos
 * diferentes: o schema (o campo não existe) e a verificação de procedência (o
 * campo existe, mas o valor não veio do briefing).
 */

const BRIEFING_COMPLETO = `Hotel Teste Lumière
Paris, França
Endereço: 12 Rue de Rivoli
Site: https://hotelteste.fr
Telefone: +33 1 42 60 30 30
Hotel boutique próximo ao centro. Tem café da manhã incluso.`;

const BRIEFING_VAGO = 'Cadastre um hotel legal em Paris.';

describe('schema: campos perigosos não existem', () => {
  it('drops rating, price, hours and coordinates even if the model returns them', () => {
    // O modelo devolveu tudo o que não devia. O schema é a barreira que não
    // depende de o prompt ter sido obedecido (§58).
    const parsed = generatedPlaceDraftSchema.parse({
      type: 'hotel',
      name: 'Hotel Teste',
      description: 'Um hotel agradável perto do centro, com atmosfera tranquila.',
      rating: 4.8,
      averagePrice: 230,
      priceLevel: 3,
      openingHours: ['Seg-Sex 08:00-22:00'],
      latitude: 48.85,
      longitude: 2.35,
      stars: 5,
    });

    for (const forbidden of [
      'rating',
      'averagePrice',
      'priceLevel',
      'openingHours',
      'latitude',
      'longitude',
      'stars',
    ]) {
      expect(parsed).not.toHaveProperty(forbidden);
    }
    expect(parsed.description).toBeTruthy();
  });
});

describe('grounding: fatos só passam se vierem do briefing', () => {
  it('preserves the facts the administrator actually provided (§64)', () => {
    const draft: GeneratedPlaceDraft = {
      type: 'hotel',
      name: 'Hotel Teste Lumière',
      city: 'Paris',
      country: 'França',
      address: '12 Rue de Rivoli',
      phone: '+33 1 42 60 30 30',
      partnerUrl: 'https://hotelteste.fr',
      amenities: ['Café da manhã incluso'],
      description: 'Um hotel boutique a poucos passos do centro de Paris.',
    };

    const { draft: grounded, dropped } = groundPlaceDraft(draft, BRIEFING_COMPLETO);

    expect(dropped).toEqual([]);
    expect(grounded.address).toBe('12 Rue de Rivoli');
    expect(grounded.partnerUrl).toBe('https://hotelteste.fr');
    expect(grounded.phone).toBe('+33 1 42 60 30 30');
    expect(grounded.amenities).toEqual(['Café da manhã incluso']);
    // O texto editorial passa sem verificação: é o trabalho pedido (§23).
    expect(grounded.description).toBeTruthy();
  });

  it('strips invented address, phone, url and amenities (§65)', () => {
    // Exatamente o cenário do §65: briefing vago, modelo preenche tudo.
    const hallucinated: GeneratedPlaceDraft = {
      type: 'hotel',
      name: 'Hôtel des Grands Boulevards',
      city: 'Paris',
      country: 'França',
      address: '17 Boulevard Poissonnière, 75002',
      phone: '+33 1 85 73 33 33',
      partnerUrl: 'https://grandsboulevards.example',
      amenities: ['Wi-Fi gratuito', 'Estacionamento', 'Piscina'],
      description: 'Um hotel encantador no coração da cidade.',
    };

    const { draft: grounded, dropped } = groundPlaceDraft(hallucinated, BRIEFING_VAGO);

    expect(grounded.address).toBeUndefined();
    expect(grounded.phone).toBeUndefined();
    expect(grounded.partnerUrl).toBeUndefined();
    expect(grounded.amenities).toBeUndefined();
    expect(grounded.name).toBeUndefined();

    // "Paris" estava no briefing, então a cidade é legítima.
    expect(grounded.city).toBe('Paris');
    // E a descrição editorial continua — o recurso ainda é útil (§23, §38).
    expect(grounded.description).toBeTruthy();

    // O admin precisa saber o que ficou faltando, senão parece falha (§59).
    expect(dropped).toEqual(
      expect.arrayContaining(['nome', 'endereço', 'telefone', 'link externo']),
    );
  });

  it('tolerates the model reformatting an address it was given', () => {
    const draft: GeneratedPlaceDraft = {
      type: 'hotel',
      // Mesmo endereço do briefing, com o bairro acrescentado na formatação.
      address: '12 Rue de Rivoli, 4º arrondissement',
    };
    const { draft: grounded } = groundPlaceDraft(draft, BRIEFING_COMPLETO);
    expect(grounded.address).toBe('12 Rue de Rivoli, 4º arrondissement');
  });

  it('compares phones by digits, not by formatting', () => {
    const draft: GeneratedPlaceDraft = { type: 'hotel', phone: '+33 142 603 030' };
    const { draft: grounded } = groundPlaceDraft(draft, 'Telefone: +33 1 42 60 30 30');
    expect(grounded.phone).toBe('+33 142 603 030');
  });

  it('rejects a url whose host was never mentioned', () => {
    const draft: GeneratedPlaceDraft = {
      type: 'restaurant',
      partnerUrl: 'https://www.opentable.com/r/algum-lugar',
    };
    const { draft: grounded } = groundPlaceDraft(draft, 'Site: https://hotelteste.fr');
    expect(grounded.partnerUrl).toBeUndefined();
  });

  it('keeps only the amenities that were named (§24)', () => {
    const draft: GeneratedPlaceDraft = {
      type: 'hotel',
      amenities: ['Café da manhã incluso', 'Academia', 'Spa'],
    };
    const { draft: grounded, dropped } = groundPlaceDraft(draft, BRIEFING_COMPLETO);
    expect(grounded.amenities).toEqual(['Café da manhã incluso']);
    expect(dropped).toContain('comodidades não informadas');
  });
});
