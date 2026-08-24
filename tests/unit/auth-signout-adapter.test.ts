/**
 * O encerramento da sessão no adaptador Supabase — a causa-raiz do defeito, na
 * segunda investigação.
 *
 * O que a primeira rodada errou: ela colocou um teto na espera, mas manteve a
 * conclusão pendurada na rede. `auth.signOut()` **não é uma operação local** em
 * nenhum `scope` — ela chama `/logout` e só depois remove o token do aparelho.
 * Quando essa ida fica pendurada (ou quando o token já venceu e a renovação
 * embutida na própria chamada falha), a sessão **sobrevive**. O adaptador então
 * lançava, a tela mostrava "não foi possível sair", e a pessoa continuava
 * dentro do aplicativo — exatamente o sintoma relatado no aparelho.
 *
 * O contrato novo, que estes cenários fixam:
 *
 *  - o `scope` é `'local'`: o botão pede para sair **daqui**, não para revogar
 *    as sessões dos outros aparelhos;
 *  - se a sessão sobreviver à chamada, o adaptador **apaga o token ele mesmo**,
 *    sem rede;
 *  - quem responde "saiu?" é o armazenamento, nunca o retorno da chamada;
 *  - a exceção fica reservada ao único caso em que a saída de fato não
 *    aconteceu: nem a biblioteca nem a remoção direta conseguiram limpar.
 *
 * O dublê é o cliente do Supabase, que é a fronteira de rede. O adaptador
 * testado é o de verdade.
 */

type Repositories = typeof import('@/repositories');

const mockAuth = {
  signOut: jest.fn(),
  getSession: jest.fn(),
};

const mockForgetLocalSession = jest.fn(async () => {
  // O efeito real: sem token no disco, a sessão acabou.
  mockAuth.getSession.mockResolvedValue(semSessao);
});

jest.mock('@/repositories/supabase/client', () => ({
  getSupabaseClient: () => ({ auth: mockAuth }),
  forgetLocalSession: () => mockForgetLocalSession(),
  supabaseAuthStorageKey: () => 'sb-projeto-auth-token',
}));

/** Carrega o módulo com o ambiente de produção montado, para cair no adaptador Supabase. */
function loadRepositories(): Repositories {
  let loaded!: Repositories;
  jest.isolateModules(() => {
    const previous = { ...process.env };
    Object.assign(process.env, {
      EXPO_PUBLIC_SUPABASE_URL: 'https://projeto.supabase.co',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_abc123',
    });
    loaded = require('@/repositories') as Repositories;
    process.env = previous;
  });
  return loaded;
}

/** Uma promessa que nunca resolve — a rede que não responde. */
const pendurada = () => new Promise<never>(() => {});

const comSessao = { data: { session: { access_token: 'token' } } };
const semSessao = { data: { session: null } };

beforeEach(() => {
  mockAuth.signOut.mockReset();
  mockAuth.getSession.mockReset();
  mockForgetLocalSession.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('sair no adaptador Supabase', () => {
  it('encerra e volta quando o servidor colabora', async () => {
    mockAuth.signOut.mockResolvedValue({ error: null });
    mockAuth.getSession.mockResolvedValue(semSessao);

    const { authAdapter } = loadRepositories();
    await expect(authAdapter.signOut()).resolves.toBeUndefined();

    expect(mockAuth.signOut).toHaveBeenCalledTimes(1);
    // Caminho limpo: a própria biblioteca apagou o token e emitiu `SIGNED_OUT`.
    expect(mockForgetLocalSession).not.toHaveBeenCalled();
  });

  it('pede escopo local, e não global', async () => {
    // O botão "Sair" encerra **esta** sessão. Revogar as sessões dos outros
    // aparelhos da pessoa não foi pedido — e é o `scope: 'global'` (o padrão)
    // que torna a chamada mais cara e mais fácil de pendurar.
    mockAuth.signOut.mockResolvedValue({ error: null });
    mockAuth.getSession.mockResolvedValue(semSessao);

    const { authAdapter } = loadRepositories();
    await authAdapter.signOut();

    expect(mockAuth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('não denuncia falha quando a sessão local já foi embora', async () => {
    // Acontece de verdade: a revogação remota é recusada, mas o supabase-js
    // apaga a sessão deste aparelho assim mesmo. Ler só o `error` faria a tela
    // mostrar "não foi possível sair" para alguém que já saiu.
    mockAuth.signOut.mockResolvedValue({ error: { message: 'Auth session missing' } });
    mockAuth.getSession.mockResolvedValue(semSessao);

    const { authAdapter } = loadRepositories();
    await expect(authAdapter.signOut()).resolves.toBeUndefined();
  });

  it('apaga o token ele mesmo quando a chamada volta com a sessão de pé', async () => {
    // O caso que derrubava o logout no aparelho: `signOut()` volta cedo (token
    // vencido, renovação interna falhando) sem apagar nada. Antes, o adaptador
    // lançava aqui e a pessoa continuava logada.
    mockAuth.signOut.mockResolvedValue({ error: { message: 'failed to fetch' } });
    mockAuth.getSession.mockResolvedValue(comSessao);

    const { authAdapter } = loadRepositories();
    await expect(authAdapter.signOut()).resolves.toBeUndefined();

    expect(mockForgetLocalSession).toHaveBeenCalledTimes(1);
    // E reconcilia a contabilidade da biblioteca com o disco já limpo — é essa
    // segunda chamada, agora sem token para revogar, que emite `SIGNED_OUT` e
    // invalida uma renovação em voo.
    expect(mockAuth.signOut).toHaveBeenCalledTimes(2);
  });

  it('não fica presa numa rede que não responde', async () => {
    jest.useFakeTimers();
    // A promessa da rede nunca volta; a sessão local, porém, já foi apagada.
    mockAuth.signOut.mockReturnValue(pendurada());
    mockAuth.getSession.mockResolvedValue(semSessao);

    const { authAdapter } = loadRepositories();
    const saida = authAdapter.signOut();

    await jest.advanceTimersByTimeAsync(3_000);

    // Antes, esta era a espera sem fim que deixava a interface logada.
    await expect(saida).resolves.toBeUndefined();
  });

  it('estourado o prazo com a sessão viva, sai assim mesmo', async () => {
    jest.useFakeTimers();
    mockAuth.signOut.mockReturnValue(pendurada());
    mockAuth.getSession.mockResolvedValue(comSessao);

    const { authAdapter } = loadRepositories();
    const saida = authAdapter.signOut();

    // Prazo da rede + conferência + a segunda chamada, também pendurada.
    await jest.advanceTimersByTimeAsync(10_000);

    await expect(saida).resolves.toBeUndefined();
    expect(mockForgetLocalSession).toHaveBeenCalledTimes(1);
  });

  it('só lança quando nem a remoção direta consegue apagar a sessão', async () => {
    // O armazenamento do aparelho recusou a escrita. Aí a saída realmente não
    // aconteceu, e dizer o contrário faria o app limpar o estado de uma conta
    // que continua autenticada.
    mockAuth.signOut.mockResolvedValue({ error: { message: 'failed to fetch' } });
    mockAuth.getSession.mockResolvedValue(comSessao);
    mockForgetLocalSession.mockImplementationOnce(async () => {
      // Não muda nada: a sessão continua no disco.
    });

    const { authAdapter } = loadRepositories();
    await expect(authAdapter.signOut()).rejects.toThrow(/conexão|internet/i);
  });
});
