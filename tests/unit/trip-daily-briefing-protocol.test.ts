import fs from 'node:fs';
import path from 'node:path';

import {
  DAILY_BRIEFING_CRON_HEADER,
  authorizeDailyBriefing,
  isDailyBriefingMethodAllowed,
  runClaimedBatch,
  type HeaderReader,
} from '../../supabase/functions/trip-daily-briefing/protocol';

function headers(values: Record<string, string>): HeaderReader {
  const normalized = new Map(
    Object.entries(values).map(([name, value]) => [name.toLowerCase(), value]),
  );
  return {
    get(name) {
      return normalized.get(name.toLowerCase()) ?? null;
    },
  };
}

describe('protocolo HTTP do briefing diário', () => {
  const serviceRoleKey = 'service-role-secret-value';
  const cronSecret = 'dedicated-cron-secret-value';

  it('aceita somente POST como método de execução', () => {
    expect(isDailyBriefingMethodAllowed('POST')).toBe(true);
    expect(isDailyBriefingMethodAllowed('post')).toBe(true);
    expect(isDailyBriefingMethodAllowed('GET')).toBe(false);
    expect(isDailyBriefingMethodAllowed('PUT')).toBe(false);
  });

  it('autoriza o cron que apresenta service role e segredo dedicado', () => {
    expect(
      authorizeDailyBriefing(
        headers({
          authorization: `Bearer ${serviceRoleKey}`,
          [DAILY_BRIEFING_CRON_HEADER]: cronSecret,
        }),
        serviceRoleKey,
        cronSecret,
      ),
    ).toEqual({ ok: true });
  });

  it('nega com 403 um JWT autenticado comum, mesmo conhecendo o header do cron', () => {
    const userJwt = 'authenticated-user-jwt';
    const result = authorizeDailyBriefing(
      headers({
        authorization: `Bearer ${userJwt}`,
        [DAILY_BRIEFING_CRON_HEADER]: cronSecret,
      }),
      serviceRoleKey,
      cronSecret,
    );

    expect(result).toEqual({ ok: false, status: 403, reason: 'forbidden' });
    expect(JSON.stringify(result)).not.toContain(userJwt);
    expect(JSON.stringify(result)).not.toContain(cronSecret);
  });

  it('não revela configuração ausente para um JWT comum', () => {
    expect(
      authorizeDailyBriefing(
        headers({ authorization: 'Bearer authenticated-user-jwt' }),
        serviceRoleKey,
        undefined,
      ),
    ).toEqual({ ok: false, status: 403, reason: 'forbidden' });
  });

  it('nega quando falta qualquer uma das duas credenciais', () => {
    expect(
      authorizeDailyBriefing(
        headers({ authorization: `Bearer ${serviceRoleKey}` }),
        serviceRoleKey,
        cronSecret,
      ),
    ).toEqual({ ok: false, status: 403, reason: 'forbidden' });

    expect(
      authorizeDailyBriefing(
        headers({ [DAILY_BRIEFING_CRON_HEADER]: cronSecret }),
        serviceRoleKey,
        cronSecret,
      ),
    ).toEqual({ ok: false, status: 403, reason: 'forbidden' });
  });

  it('falha fechado e sem refletir segredo quando o servidor está mal configurado', () => {
    const result = authorizeDailyBriefing(
      headers({
        authorization: `Bearer ${serviceRoleKey}`,
        [DAILY_BRIEFING_CRON_HEADER]: cronSecret,
      }),
      serviceRoleKey,
      undefined,
    );

    expect(result).toEqual({ ok: false, status: 503, reason: 'misconfigured' });
    expect(JSON.stringify(result)).not.toContain(serviceRoleKey);
    expect(JSON.stringify(result)).not.toContain(cronSecret);
  });

  it('mantém a validação JWT ligada no gateway da Function', () => {
    const config = fs.readFileSync(path.join(process.cwd(), 'supabase/config.toml'), 'utf8');
    const section = config.split('[functions.trip-daily-briefing]')[1]?.split(/\n\[/)[0] ?? '';

    expect(section).toMatch(/\bverify_jwt\s*=\s*true\b/);
  });
});

describe('claim idempotente antes de providers', () => {
  it('não chama clima/Gemini quando todos os claims são duplicados', async () => {
    const claim = jest.fn(async () => null);
    const providers = jest.fn(async () => 'provider-result');

    const result = await runClaimedBatch(['member-a', 'member-b'], claim, providers);

    expect(claim).toHaveBeenCalledTimes(2);
    expect(providers).not.toHaveBeenCalled();
    expect(result).toEqual({ claims: [] });
  });

  it('termina todos os claims e envia ao provider somente os vencedores', async () => {
    const events: string[] = [];
    const claim = jest.fn(async (member: string) => {
      events.push(`claim:${member}`);
      return member === 'duplicate' ? null : { member };
    });
    const providers = jest.fn(async (claims: readonly { member: string }[]) => {
      events.push(`provider:${claims.map((claimValue) => claimValue.member).join(',')}`);
      return claims.length;
    });

    const result = await runClaimedBatch(['member-a', 'duplicate', 'member-b'], claim, providers);

    expect(events).toEqual([
      'claim:member-a',
      'claim:duplicate',
      'claim:member-b',
      'provider:member-a,member-b',
    ]);
    expect(providers).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      claims: [{ member: 'member-a' }, { member: 'member-b' }],
      providerResult: 2,
    });
  });
});
