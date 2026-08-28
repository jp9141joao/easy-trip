import {
  PUSH_BODY_LIMIT,
  PUSH_SECRET_HEADER,
  PUSH_TITLE_LIMIT,
  authorizePush,
  buildMessages,
  isPushMethodAllowed,
  parsePushRequest,
  readTickets,
  sanitizePushText,
} from '../../supabase/functions/send-push/protocol';
import { destinationRoute, readDestination } from '@/services/pushNotifications';

/**
 * Notificação push (§33, migration 0016).
 *
 * O que este arquivo protege são as três coisas que, erradas, causam dano real:
 *
 *   1. quem pode fazer o aparelho de alguém tocar;
 *   2. o que o texto pode dizer na TELA DE BLOQUEIO, que é lida por quem
 *      estiver perto do telefone e não tem sessão nenhuma;
 *   3. o que se desativa quando o serviço recusa um token — desativar demais é
 *      um aparelho que para de receber em silêncio.
 *
 * O isolamento dos tokens é do banco, e o teste dele é
 * `supabase/tests/push_tokens.test.sql`.
 */

const SERVICE = 'service-role-de-teste';
const SEGREDO = 'segredo-de-envio';

const headers = (h: Record<string, string>) => ({
  get: (name: string) => h[name.toLowerCase()] ?? null,
});

/* ------------------------------ autorização ------------------------------- */

describe('quem pode mandar', () => {
  it('service role e segredo: passa', () => {
    expect(
      authorizePush(
        headers({ authorization: `Bearer ${SERVICE}`, [PUSH_SECRET_HEADER]: SEGREDO }),
        SERVICE,
        SEGREDO,
      ),
    ).toEqual({ ok: true });
  });

  it('JWT comum: 403', () => {
    expect(
      authorizePush(
        headers({ authorization: 'Bearer jwt-de-usuario', [PUSH_SECRET_HEADER]: SEGREDO }),
        SERVICE,
        SEGREDO,
      ),
    ).toMatchObject({ ok: false, status: 403 });
  });

  it('JWT comum continua 403 mesmo sem o segredo instalado', () => {
    // Configuração interna não é informação para quem não tem privilégio, e
    // autorização nunca pode virar 503 por acaso.
    expect(
      authorizePush(headers({ authorization: 'Bearer jwt-de-usuario' }), SERVICE, undefined),
    ).toMatchObject({ ok: false, status: 403 });
  });

  it('service role sem o segredo: 403', () => {
    expect(
      authorizePush(headers({ authorization: `Bearer ${SERVICE}` }), SERVICE, SEGREDO),
    ).toMatchObject({ ok: false, status: 403 });
  });

  it('service role com o segredo errado: 403', () => {
    expect(
      authorizePush(
        headers({ authorization: `Bearer ${SERVICE}`, [PUSH_SECRET_HEADER]: 'outro' }),
        SERVICE,
        SEGREDO,
      ),
    ).toMatchObject({ ok: false, status: 403 });
  });

  it('sem service role configurada: 503, e não "pode entrar"', () => {
    expect(authorizePush(headers({}), undefined, SEGREDO)).toMatchObject({
      ok: false,
      status: 503,
    });
  });

  it('só POST', () => {
    expect(isPushMethodAllowed('POST')).toBe(true);
    for (const m of ['GET', 'PUT', 'DELETE', 'PATCH']) {
      expect(isPushMethodAllowed(m)).toBe(false);
    }
  });
});

/* -------------------------------- o texto --------------------------------- */

describe('o que NÃO vai para a tela de bloqueio', () => {
  it.each([
    ['Maria lançou R$ 4.200 em hospedagem', 'valor em reais'],
    ['Gasto de US$ 1,500 hoje', 'valor em dólar'],
    ['Total: 1.250,00 no cartão', 'valor sem símbolo'],
    ['Convite de maria.silva@exemplo.com', 'e-mail'],
    ['Ligue (11) 98765-4321', 'telefone'],
    ['Documento 12345678901', 'sequência longa de dígitos'],
  ])('corta %s (%s)', (texto) => {
    expect(sanitizePushText(texto).redacted).toBe(true);
  });

  it('um texto sem nada sensível passa inteiro', () => {
    const r = sanitizePushText('Bom dia! Hoje Lisboa te espera.');
    expect(r.redacted).toBe(false);
    expect(r.text).toBe('Bom dia! Hoje Lisboa te espera.');
  });

  it('o valor não sobra em pedaços', () => {
    // Cortar "R$" e deixar "4.200" seria pior do que não cortar: continua
    // dizendo quanto, e ainda parece um defeito.
    const r = sanitizePushText('Maria lançou R$ 4.200 em hospedagem');
    expect(r.text).not.toMatch(/4[.,]?200/);
    expect(r.text).not.toMatch(/R\$/);
  });
});

describe('a mensagem montada', () => {
  const pedido = {
    userId: 'u1',
    title: 'Convite de viagem',
    body: 'Ana convidou você para Lisboa.',
    tripId: 't1',
    notificationId: 'n1',
  };

  it('uma mensagem por aparelho', () => {
    // A mesma conta pode ter telefone e tablet, e o aviso vale nos dois.
    const msgs = buildMessages(pedido, ['ExponentPushToken[A]', 'ExponentPushToken[B]']);
    expect(msgs).toHaveLength(2);
    expect(msgs.map((m) => m.to)).toEqual(['ExponentPushToken[A]', 'ExponentPushToken[B]']);
  });

  it('o texto limpo passa como está', () => {
    const [msg] = buildMessages(pedido, ['t']);
    expect(msg.title).toBe('Convite de viagem');
    expect(msg.body).toBe('Ana convidou você para Lisboa.');
  });

  it('um corpo com valor vira convite a abrir o aplicativo', () => {
    const [msg] = buildMessages(
      { ...pedido, body: 'Maria lançou R$ 4.200 em hospedagem' },
      ['t'],
    );
    expect(msg.body).toBe('Você tem uma novidade na sua viagem. Toque para ver.');
    expect(msg.body).not.toMatch(/4/);
  });

  it('um título com valor vira o nome do aplicativo', () => {
    const [msg] = buildMessages({ ...pedido, title: 'Você gastou R$ 900 hoje' }, ['t']);
    expect(msg.title).toBe('Easy Trip');
  });

  it('o data carrega identificadores, e nada de conteúdo', () => {
    // O conteúdo é lido pelo aplicativo já autenticado. Um push que o
    // carregasse faria o dado viajar por fora da sessão.
    const [msg] = buildMessages(pedido, ['t']);
    expect(msg.data).toEqual({ tripId: 't1', notificationId: 'n1' });
    expect(JSON.stringify(msg.data)).not.toMatch(/Ana|Lisboa/);
  });

  it('títulos e corpos longos são truncados', () => {
    const [msg] = buildMessages(
      { ...pedido, title: 'a'.repeat(200), body: 'b'.repeat(400) },
      ['t'],
    );
    expect(msg.title.length).toBeLessThanOrEqual(PUSH_TITLE_LIMIT);
    expect((msg.body ?? '').length).toBeLessThanOrEqual(PUSH_BODY_LIMIT);
  });

  it('sem corpo, a mensagem sai só com título', () => {
    const [msg] = buildMessages({ userId: 'u1', title: 'Lembrete' }, ['t']);
    expect(msg.body).toBeUndefined();
  });

  it('sem token, não há mensagem', () => {
    expect(buildMessages(pedido, [])).toEqual([]);
  });
});

/* ------------------------------- os recibos ------------------------------- */

describe('o que o serviço respondeu', () => {
  it('tudo entregue', () => {
    const r = readTickets(['a', 'b'], [{ status: 'ok' }, { status: 'ok' }]);
    expect(r).toEqual({ delivered: 2, failed: 0, invalidTokens: [] });
  });

  it('DeviceNotRegistered desativa aquele token', () => {
    const r = readTickets(
      ['a', 'b'],
      [{ status: 'ok' }, { status: 'error', details: { error: 'DeviceNotRegistered' } }],
    );
    expect(r.delivered).toBe(1);
    expect(r.invalidTokens).toEqual(['b']);
  });

  it('outros erros NÃO desativam nada', () => {
    // Um token desativado por engano é um aparelho que para de receber em
    // silêncio, e ninguém descobre até alguém reclamar.
    const r = readTickets(
      ['a', 'b'],
      [
        { status: 'error', details: { error: 'MessageRateExceeded' } },
        { status: 'error', message: 'internal server error' },
      ],
    );
    expect(r.failed).toBe(2);
    expect(r.invalidTokens).toEqual([]);
  });

  it('recibo faltando conta como falha, e não como entrega', () => {
    const r = readTickets(['a', 'b'], [{ status: 'ok' }]);
    expect(r.delivered).toBe(1);
    expect(r.failed).toBe(0);
  });
});

/* -------------------------------- o pedido -------------------------------- */

describe('validação do pedido', () => {
  it('aceita o mínimo', () => {
    expect(parsePushRequest({ userId: 'u1', title: 'Oi' })).toMatchObject({
      userId: 'u1',
      title: 'Oi',
    });
  });

  const invalidos: [unknown, string][] = [
    [null, 'nulo'],
    [{}, 'vazio'],
    [{ title: 'Oi' }, 'sem destinatário'],
    [{ userId: 'u1' }, 'sem título'],
    [{ userId: '  ', title: 'Oi' }, 'destinatário em branco'],
    [{ userId: 'u1', title: '   ' }, 'título em branco'],
    [{ userId: 1, title: 'Oi' }, 'destinatário que não é texto'],
  ];

  it.each(invalidos)('recusa %p (%s)', (body) => {
    // Sem `userId` o envio não teria destinatário, e um padrão qualquer aqui
    // seria "mande para alguém".
    expect(parsePushRequest(body)).toBeNull();
  });

  it('descarta campos que não conhece', () => {
    const r = parsePushRequest({ userId: 'u1', title: 'Oi', admin: true, sql: 'drop' });
    expect(r).toEqual({
      userId: 'u1',
      title: 'Oi',
      body: undefined,
      tripId: undefined,
      notificationId: undefined,
    });
  });
});

/* ------------------------------ o toque ----------------------------------- */

describe('para onde o toque leva', () => {
  const resposta = (data: unknown) => ({ notification: { request: { content: { data } } } });

  it('uma viagem leva à viagem', () => {
    expect(destinationRoute(readDestination(resposta({ tripId: 't1' })))).toBe('/trip/t1');
  });

  it('um aviso sem viagem leva à Central', () => {
    expect(destinationRoute(readDestination(resposta({ notificationId: 'n1' })))).toBe('/alerts');
  });

  it('sem destino, não navega', () => {
    expect(destinationRoute(readDestination(resposta({})))).toBeNull();
    expect(destinationRoute(readDestination(resposta(null)))).toBeNull();
    expect(destinationRoute(readDestination({}))).toBeNull();
  });

  it('um data com tipo errado não vira rota', () => {
    // O `data` chega de fora do aplicativo: é entrada não confiável.
    expect(destinationRoute(readDestination(resposta({ tripId: { evil: true } })))).toBeNull();
    expect(destinationRoute(readDestination(resposta('texto solto')))).toBeNull();
  });
});

/* ---------------------------- ordem das checagens -------------------------- */

describe('configuração nunca vaza para quem não se autenticou', () => {
  /**
   * Regressão de um defeito real, encontrado pela sondagem de segurança
   * (`scripts/security-probe.mjs`, MASVS-CODE-4).
   *
   * `admin-generate-content` checava `GEMINI_API_KEY` ANTES de autenticar, e
   * respondia 503 "o serviço de IA não está configurado" para qualquer chamador
   * sem credencial — um detalhe da implantação entregue a quem não provou ser
   * ninguém.
   *
   * O princípio já estava escrito em `trip-daily-briefing/protocol.ts`:
   * *auth nunca pode virar 503 por acaso*. Estas asserções o prendem nas três
   * funções que têm credencial de servidor, para o próximo arquivo do gênero
   * não repetir o erro.
   */
  const fonte = (nome: string) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../../supabase/functions', nome, 'index.ts'),
      'utf8',
    ) as string;

  it.each(['admin-generate-content', 'send-push', 'trip-daily-briefing'])(
    '%s autentica antes de olhar a própria configuração',
    (nome) => {
      const src = fonte(nome);
      const dentroDoHandler = src.slice(src.indexOf('Deno.serve'));

      const primeiro503 = dentroDoHandler.indexOf('503');
      const primeiraAuth = Math.min(
        ...['getUser(', 'authorizePush(', 'authorizeDailyBriefing(']
          .map((marca) => dentroDoHandler.indexOf(marca))
          .filter((i) => i >= 0),
      );

      expect(primeiraAuth).toBeGreaterThanOrEqual(0);
      if (primeiro503 >= 0) {
        expect(primeiro503).toBeGreaterThan(primeiraAuth);
      }
    },
  );
});
