import {
  MAX_REMINDER_MINUTES,
  REMINDER_OFFSETS,
  computeRemindAt,
  offsetMinutesBetween,
  reminderOffsetLabel,
} from '@/domain/reminders';

/**
 * Lembretes (§30–§32).
 *
 * A regra que mais importa: um lembrete nunca é criado no passado. A Central
 * mostraria "Check-in amanhã" na abertura seguinte, para um check-in de ontem.
 */
const AGORA = new Date('2026-08-24T10:00:00.000Z');

describe('quando o lembrete dispara', () => {
  it('subtrai o intervalo do instante da reserva', () => {
    const remindAt = computeRemindAt('2026-08-24T15:00:00.000Z', 60, AGORA);
    expect(remindAt).toBe('2026-08-24T14:00:00.000Z');
  });

  it('um dia antes é 1440 minutos', () => {
    const remindAt = computeRemindAt('2026-08-26T15:00:00.000Z', 1440, AGORA);
    expect(remindAt).toBe('2026-08-25T15:00:00.000Z');
  });

  it('NÃO cria lembrete que já venceu', () => {
    // Reserva às 15h, lembrete de 1 dia antes: cairia em 23/08, ontem.
    expect(computeRemindAt('2026-08-24T15:00:00.000Z', 1440, AGORA)).toBeUndefined();
  });

  it('não cria lembrete para um instante que já passou', () => {
    expect(computeRemindAt('2026-08-23T15:00:00.000Z', 60, AGORA)).toBeUndefined();
  });

  it('sem instante-âncora não há do que lembrar', () => {
    expect(computeRemindAt(undefined, 60, AGORA)).toBeUndefined();
  });

  it('data ilegível não vira Invalid Date gravado', () => {
    expect(computeRemindAt('amanhã cedo', 60, AGORA)).toBeUndefined();
  });
});

describe('as opções oferecidas (§30)', () => {
  it('cobre de 15 minutos a 1 dia', () => {
    expect(REMINDER_OFFSETS.map((option) => option.minutes)).toEqual([15, 30, 60, 180, 1440]);
  });

  it('o personalizado tem teto de uma semana', () => {
    expect(MAX_REMINDER_MINUTES).toBe(7 * 24 * 60);
  });

  it('rotula qualquer intervalo, inclusive fora da lista', () => {
    expect(reminderOffsetLabel(60)).toBe('1 hora antes');
    expect(reminderOffsetLabel(1440)).toBe('1 dia antes');
    expect(reminderOffsetLabel(2880)).toBe('2 dias antes');
    expect(reminderOffsetLabel(120)).toBe('2 horas antes');
    expect(reminderOffsetLabel(45)).toBe('45 minutos antes');
  });
});

describe('reabrir a reserva mostra o seletor na posição certa', () => {
  it('reconstrói o intervalo a partir do lembrete gravado', () => {
    expect(
      offsetMinutesBetween('2026-08-24T14:00:00.000Z', '2026-08-24T15:00:00.000Z'),
    ).toBe(60);
  });

  it('lembrete depois da âncora é incoerente e não devolve intervalo', () => {
    expect(
      offsetMinutesBetween('2026-08-24T16:00:00.000Z', '2026-08-24T15:00:00.000Z'),
    ).toBeUndefined();
  });
});
