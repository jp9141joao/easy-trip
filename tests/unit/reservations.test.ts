import {
  RESERVATION_CATEGORIES,
  RESERVATION_TIME_LABELS,
  RESERVATION_TYPES,
  anchorLabel,
  parseReservationDetails,
  reminderAnchors,
  reservationCategory,
} from '@/domain/reservations';
import { reservationSchema } from '@/domain/schemas';

/**
 * O modelo de Reservas (§22–§29, cenário 4 do §74).
 */
describe('as seis modalidades do produto (§23)', () => {
  it('voo, hospedagem, carro, ingresso, trem e ônibus são criáveis', () => {
    const criaveis = RESERVATION_CATEGORIES.filter((c) => c.creatable).map((c) => c.type);
    expect(criaveis).toEqual(['flight', 'hotel', 'car', 'park_ticket', 'train', 'bus']);
  });

  it('"other" existe, mas não é oferecida para criação', () => {
    // Ela recebe o que a normalização da 0011 não conseguiu traduzir. Ninguém
    // quer reservar "outro".
    expect(RESERVATION_TYPES).toContain('other');
    expect(reservationCategory('other').creatable).toBe(false);
  });

  it('toda modalidade tem rótulo, plural e emoji', () => {
    for (const type of RESERVATION_TYPES) {
      const category = reservationCategory(type);
      expect(category.label.length).toBeGreaterThan(0);
      expect(category.plural.length).toBeGreaterThan(0);
      expect(category.emoji.length).toBeGreaterThan(0);
    }
  });

  it('tipo desconhecido cai em "other" em vez de quebrar a lista', () => {
    expect(reservationCategory('inexistente' as never).type).toBe('other');
  });
});

describe('o mesmo instante significa coisas diferentes (§24)', () => {
  it('hotel fala de check-in e check-out; voo fala de partida e chegada', () => {
    expect(RESERVATION_TIME_LABELS.hotel.start).toBe('Check-in');
    expect(RESERVATION_TIME_LABELS.hotel.end).toBe('Check-out');
    expect(RESERVATION_TIME_LABELS.flight.start).toBe('Partida');
    expect(RESERVATION_TIME_LABELS.flight.end).toBe('Chegada');
    expect(RESERVATION_TIME_LABELS.car.start).toBe('Retirada');
    expect(RESERVATION_TIME_LABELS.car.end).toBe('Devolução');
  });

  it('ingresso tem um instante só — não existe "fim do ingresso"', () => {
    expect(RESERVATION_TIME_LABELS.park_ticket.end).toBeUndefined();
    expect(reminderAnchors('park_ticket')).toEqual(['start']);
  });

  it('carro tem lembrete nos dois — a devolução é a que se esquece (§30)', () => {
    expect(reminderAnchors('car')).toEqual(['start', 'end']);
    expect(anchorLabel('car', 'end')).toBe('Devolução');
  });
});

describe('details por modalidade (§25–§29)', () => {
  it('voo aceita número do voo, terminais, assento e bagagem', () => {
    const details = parseReservationDetails('flight', {
      flightNumber: 'AF457',
      departureTerminal: 'T3',
      arrivalTerminal: '2E',
      seat: '24A',
      baggage: '1 despachada de 23 kg',
    });
    expect(details).toMatchObject({ flightNumber: 'AF457', seat: '24A' });
  });

  it('campo de outra modalidade não vaza para dentro do registro', () => {
    // Um `details` de voo gravado numa hospedagem não pode aparecer na tela do
    // hotel como se fosse dela.
    const details = parseReservationDetails('hotel', { flightNumber: 'AF457', room: '412' });
    expect(details).toEqual({ room: '412' });
    expect(details).not.toHaveProperty('flightNumber');
  });

  it('JSONB malformado não derruba a lista — vira objeto vazio', () => {
    expect(parseReservationDetails('flight', 'isto não é um objeto')).toEqual({});
    expect(parseReservationDetails('flight', null)).toEqual({});
    expect(parseReservationDetails('flight', undefined)).toEqual({});
  });

  it('quantidade de ingresso é inteiro dentro de faixa razoável', () => {
    expect(parseReservationDetails('park_ticket', { quantity: 2 })).toEqual({ quantity: 2 });
    // Fora da faixa, o campo some em vez de gravar um absurdo.
    expect(parseReservationDetails('park_ticket', { quantity: 9999 })).toEqual({});
  });

  it('trem e ônibus compartilham a mesma forma', () => {
    const trem = parseReservationDetails('train', { seat: '32', carriage: '7', platform: '12' });
    const onibus = parseReservationDetails('bus', { seat: '32', carriage: '7', platform: '12' });
    expect(trem).toEqual(onibus);
  });
});

describe('o formulário comum', () => {
  it('exige tipo e título, e nada além disso', () => {
    const parsed = reservationSchema.safeParse({ type: 'flight', title: 'GRU → CDG' });
    expect(parsed.success).toBe(true);
  });

  it('recusa modalidade inexistente', () => {
    expect(reservationSchema.safeParse({ type: 'foguete', title: 'Lua' }).success).toBe(false);
  });

  it('recusa título vazio — sem ele a reserva não é identificável na lista', () => {
    expect(reservationSchema.safeParse({ type: 'hotel', title: '' }).success).toBe(false);
  });
});
