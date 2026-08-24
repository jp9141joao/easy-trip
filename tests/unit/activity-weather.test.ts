import {
  FORECAST_HORIZON_DAYS,
  daysAhead,
  isWithinForecastHorizon,
  rainAdvice,
  RAIN_ADVICE_THRESHOLD,
  type HourlyWeather,
} from '@/services/activityWeather';

/**
 * Clima por atividade (§20, §21).
 *
 * A regra: nunca inventar previsão. Fora do horizonte do serviço, a resposta é
 * "disponível mais perto da data" — não uma média climatológica disfarçada.
 */
const hora = (time: string, chance: number): HourlyWeather => ({
  time,
  temperature: 22,
  precipitationProbability: chance,
  code: 61,
  description: 'Chuva fraca',
});

describe('horizonte da previsão (§21)', () => {
  it('o Open-Meteo entrega 16 dias — e é isso que o app promete', () => {
    expect(FORECAST_HORIZON_DAYS).toBe(16);
  });

  it('hoje e amanhã estão dentro', () => {
    expect(isWithinForecastHorizon('2026-08-24', '2026-08-24')).toBe(true);
    expect(isWithinForecastHorizon('2026-08-25', '2026-08-24')).toBe(true);
  });

  it('o último dia do horizonte ainda conta', () => {
    expect(isWithinForecastHorizon('2026-09-09', '2026-08-24')).toBe(true);
  });

  it('além do horizonte, não há previsão — e o app diz isso', () => {
    expect(isWithinForecastHorizon('2026-09-10', '2026-08-24')).toBe(false);
    expect(isWithinForecastHorizon('2026-12-24', '2026-08-24')).toBe(false);
  });

  it('data no passado também não tem previsão', () => {
    expect(isWithinForecastHorizon('2026-08-23', '2026-08-24')).toBe(false);
  });

  it('conta dias de calendário, não frações', () => {
    expect(daysAhead('2026-08-31', '2026-08-24')).toBe(7);
    expect(daysAhead('2026-09-01', '2026-08-24')).toBe(8);
  });

  it('data ilegível fica fora do horizonte em vez de virar hoje', () => {
    expect(isWithinForecastHorizon('quinta que vem', '2026-08-24')).toBe(false);
  });
});

describe('aviso de chuva (§20)', () => {
  it('avisa a partir do limiar, com o horário', () => {
    const aviso = rainAdvice([hora('09:00', 10), hora('16:00', 70)]);
    expect(aviso).toContain('16:00');
    expect(aviso).toContain('70%');
    expect(aviso).toContain('guarda-chuva');
  });

  it('não avisa quando não há por que avisar — aviso diário vira ruído', () => {
    expect(rainAdvice([hora('09:00', 5), hora('16:00', 20)])).toBeUndefined();
  });

  it('dia sem previsão não gera aviso', () => {
    expect(rainAdvice([])).toBeUndefined();
  });

  it('o limiar é 40% — probabilidade, e o texto diz "chance"', () => {
    expect(RAIN_ADVICE_THRESHOLD).toBe(40);
    expect(rainAdvice([hora('12:00', 39)])).toBeUndefined();
    expect(rainAdvice([hora('12:00', 40)])).toContain('chance de chuva');
  });
});
