import { buildWhatsappUrl, isContactWhatsappConfigured } from '@/constants/contact';
import {
  buildPlaceInquiryMessage,
  placeInquiryLabel,
  supportsCommercialInquiry,
} from '@/domain/placeInquiry';
import type { Place, Trip } from '@/domain/types';

/**
 * Mensagem de contato comercial (§60, §61).
 *
 * Dois riscos concretos: dizer "restaurante" para um hotel por reaproveitar o
 * texto, e vazar dado do usuário na mensagem. Os dois são verificados aqui.
 */

const hotel: Place = {
  id: 'p1',
  name: 'Hotel Lumière Rivoli',
  type: 'hotel',
  city: 'Paris',
  country: 'França',
};

const restaurant: Place = {
  id: 'p2',
  name: "Chez Marie & Fils",
  type: 'restaurant',
  city: 'Paris',
  country: 'França',
};

const trip = (overrides: Partial<Trip> = {}): Trip => ({
  id: 't1',
  userId: 'u1',
  destinationCity: 'Paris',
  destinationCountry: 'França',
  countryCode: 'FR',
  timezone: 'Europe/Paris',
  startDate: '2026-08-20',
  endDate: '2026-08-23',
  budgetTotal: 12000,
  budgetCurrency: 'BRL',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('inquiry message', () => {
  it('speaks about hospedagem for a hotel', () => {
    const message = buildPlaceInquiryMessage(hotel);
    expect(message).toContain('Hotel Lumière Rivoli');
    expect(message).toContain('hospedagem');
    expect(message).toContain('condições de reserva');
  });

  it('speaks about the restaurant, never reusing the hotel wording', () => {
    const message = buildPlaceInquiryMessage(restaurant);
    expect(message).toContain('Chez Marie & Fils');
    expect(message).toContain('horários');
    // O erro que este teste existe para pegar (§61).
    expect(message.toLowerCase()).not.toContain('hospedagem');
    expect(message.toLowerCase()).not.toContain('hotel');
  });

  it('enriches with the trip dates when the trip is about this city', () => {
    const message = buildPlaceInquiryMessage(hotel, trip());
    expect(message).toContain('viagem a Paris');
    expect(message).toContain('de 20 a 23 de agosto');
  });

  it('spans months correctly', () => {
    const message = buildPlaceInquiryMessage(
      hotel,
      trip({ startDate: '2026-08-28', endDate: '2026-09-02' }),
    );
    expect(message).toContain('de 28 de agosto a 2 de setembro');
  });

  it('ignores an active trip to a different city', () => {
    // A viagem ativa é só a última selecionada. Sem esta regra, um restaurante
    // em Roma receberia "para minha viagem a Paris".
    const message = buildPlaceInquiryMessage(restaurant, trip({ destinationCity: 'Roma' }));
    expect(message).not.toContain('Roma');
    expect(message).not.toContain('viagem');
  });

  it('works with no active trip at all', () => {
    const message = buildPlaceInquiryMessage(restaurant, null);
    expect(message).toContain('Chez Marie & Fils');
    expect(message).not.toContain('undefined');
    expect(message).not.toContain('NaN');
  });

  it('never carries private data (§5)', () => {
    const message = buildPlaceInquiryMessage(hotel, trip());
    // Orçamento é o dado mais sensível que passaria perto: `Trip` o carrega, e
    // a função o recebe inteiro. Ele não pode aparecer.
    expect(message).not.toContain('12000');
    expect(message).not.toMatch(/or[çc]amento/i);
    expect(message).not.toContain('@');
  });
});

describe('inquiry availability', () => {
  it('offers the action for hotels and restaurants only', () => {
    expect(supportsCommercialInquiry(hotel)).toBe(true);
    expect(supportsCommercialInquiry(restaurant)).toBe(true);
    expect(supportsCommercialInquiry({ ...hotel, type: 'attraction' })).toBe(false);
  });

  it('labels the action with the right word', () => {
    expect(placeInquiryLabel(hotel)).toBe('Falar sobre este hotel');
    expect(placeInquiryLabel(restaurant)).toBe('Falar sobre este restaurante');
  });
});

describe('whatsapp url', () => {
  it('encodes accents, line breaks and ampersands', () => {
    const url = buildWhatsappUrl(buildPlaceInquiryMessage(restaurant), '5511987654321');

    expect(url.startsWith('https://wa.me/5511987654321?text=')).toBe(true);
    // Um `&` cru cortaria a mensagem no meio: o WhatsApp leria o resto como
    // outro parâmetro da URL.
    expect(url).not.toContain('Marie & Fils');
    expect(url).toContain('%26');
    expect(url).toContain('%0A');
    expect(decodeURIComponent(url.split('?text=')[1])).toContain('Chez Marie & Fils');
  });

  it('treats an unconfigured or malformed number as unavailable', () => {
    for (const value of ['', '   ', 'meu-whatsapp', '11 98765-4321', '0123456789']) {
      expect(isContactWhatsappConfigured(value)).toBe(false);
    }
    expect(isContactWhatsappConfigured('5511987654321')).toBe(true);
  });
});
