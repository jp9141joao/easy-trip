/**
 * O serviço de IA administrativa (§27, §28, §34).
 *
 * Duas garantias que não podem depender de o backend estar de pé: sem BFF o
 * recurso se declara indisponível em vez de devolver conteúdo de exemplo, e uma
 * resposta que não bate com o schema vira erro em vez de preencher o formulário
 * pela metade.
 */

const mockPostJson = jest.fn();

jest.mock('@/services/http', () => {
  const actual = jest.requireActual('@/services/http');
  return { ...actual, postJson: (...args: unknown[]) => mockPostJson(...args) };
});

const VALID_ARTICLE = {
  title: 'Por que viajar faz tão bem',
  category: 'Inspiração',
  content: 'x'.repeat(200),
  estimatedReadMinutes: 6,
  imagePrompt: 'fotografia editorial de alguém contemplando uma paisagem',
};

/**
 * Recarrega o módulo com uma configuração específica de ambiente.
 *
 * `adminContentService` escolhe a implementação uma vez, na importação, a
 * partir de `config.hasBff` — então testar os dois ambientes exige recarregar o
 * registro de módulos, e não apenas trocar um valor.
 */
function loadService(hasBff: boolean): typeof import('@/services/adminContent') {
  jest.resetModules();
  jest.doMock('@/lib/config', () => ({
    config: { bffUrl: hasBff ? 'https://bff.example' : '', hasBff, hasSupabase: hasBff, mode: 'demo' },
    hasBff,
    hasSupabase: hasBff,
  }));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@/services/adminContent') as typeof import('@/services/adminContent');
}

beforeEach(() => {
  mockPostJson.mockReset();
});

describe('sem BFF configurado', () => {
  it('declares itself unavailable instead of faking a result (§34)', async () => {
    const { adminContentService } = loadService(false);

    expect(adminContentService.kind).toBe('unavailable');
    await expect(
      adminContentService.generateArticle({ briefing: 'um artigo sobre viajar' }),
    ).rejects.toMatchObject({
      kind: 'unconfigured',
      message: expect.stringContaining('Configure o serviço de IA'),
    });
    // O ponto: nenhuma requisição, e nenhum conteúdo de mentira.
    expect(mockPostJson).not.toHaveBeenCalled();
  });
});

describe('com BFF configurado', () => {
  it('posts to the admin endpoint carrying the caller JWT (§30, §31)', async () => {
    const { adminContentService } = loadService(true);
    mockPostJson.mockResolvedValue({ data: VALID_ARTICLE });

    const result = await adminContentService.generateArticle({
      briefing: 'um artigo sobre como viajar faz bem',
      accessToken: 'jwt-do-admin',
    });

    const [url, body, options] = mockPostJson.mock.calls[0];
    expect(url).toBe('https://bff.example/admin-generate-content');
    expect(body).toMatchObject({ kind: 'article', briefing: expect.any(String) });
    expect(options.headers.Authorization).toBe('Bearer jwt-do-admin');
    expect(result.title).toBe(VALID_ARTICLE.title);
  });

  it('rejects a response that does not match the schema (§28)', async () => {
    const { adminContentService } = loadService(true);
    // Resposta plausível e errada: sem `content`, e o tempo de leitura veio
    // como texto. Preencher o formulário com isto quebraria a tela depois.
    mockPostJson.mockResolvedValue({
      data: { title: 'Algo', category: 'Dicas', estimatedReadMinutes: 'seis' },
    });

    // Comparado por `name`/`kind` e não por `instanceof`: `resetModules` cria
    // uma classe `ServiceError` nova a cada carga do módulo.
    await expect(
      adminContentService.generateArticle({ briefing: 'um artigo qualquer' }),
    ).rejects.toMatchObject({
      name: 'ServiceError',
      kind: 'parse',
      message: expect.stringContaining('interpretar a resposta da IA'),
    });
  });

  it('surfaces the BFF error message instead of inventing one', async () => {
    const { adminContentService } = loadService(true);
    mockPostJson.mockResolvedValue({ error: 'Operação restrita a administradores.' });

    await expect(
      adminContentService.generatePlace({ briefing: 'um hotel', type: 'hotel' }),
    ).rejects.toMatchObject({ message: 'Operação restrita a administradores.' });
  });

  it('never offers a generation kind beyond article and place (§48, §49)', async () => {
    const { adminContentService } = loadService(true);

    // Ofertas e Especialistas não têm caminho para a IA: não existe método.
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(adminContentService)).sort()).toEqual(
      ['constructor', 'generateArticle', 'generatePlace'].sort(),
    );
  });
});
