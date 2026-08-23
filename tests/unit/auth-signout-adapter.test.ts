/**
 * O encerramento da sessão no adaptador Supabase — a causa-raiz do defeito.
 *
 * `auth.signOut()` não é uma operação local: ela vai ao servidor revogar o
 * refresh token e **só então** apaga a sessão do aparelho. Como toda a saída do
 * aplicativo acontecia depois dessa promessa, uma rede ruim segurava a interface
 * logada — enquanto o token no disco já tinha ido embora. Daí o sintoma
 * relatado: "só sai depois de fechar e abrir o app".
 *
 * O que estes cenários fixam é o contrato novo:
 *
 *  - a espera tem teto;
 *  - quem responde "saiu?" é o armazenamento local, não o retorno da chamada;
 *  - e quando a sessão sobrevive, o adaptador **lança** — a interface precisa
 *    poder dizer que não deu, em vez de fingir uma saída.
 *
 * O dublê é o cliente do Supabase, que é a fronteira de rede. O adaptador
 * testado é o de verdade.
 */

type Repositories = typeof import('@/repositories');

const mockAuth = {
  signOut: jest.fn(),
  getSession: jest.fn(),
};

jest.mock('@/repositories/supabase/client', () => ({
  getSupabaseClient: () => ({ auth: mockAuth }),
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

  it('lança quando a sessão continua de pé', async () => {
    // O caso oposto: `signOut()` voltou cedo, sem apagar nada. Resolver aqui
    // seria dizer que saiu — e o aplicativo limparia o estado de uma conta que
    // continua autenticada.
    mockAuth.signOut.mockResolvedValue({ error: { message: 'failed to fetch' } });
    mockAuth.getSession.mockResolvedValue(comSessao);

    const { authAdapter } = loadRepositories();
    await expect(authAdapter.signOut()).rejects.toThrow(/conexão|internet/i);
  });

  it('não fica presa numa rede que não responde', async () => {
    jest.useFakeTimers();
    // A promessa da rede nunca volta; a sessão local, porém, já foi apagada.
    mockAuth.signOut.mockReturnValue(pendurada());
    mockAuth.getSession.mockResolvedValue(semSessao);

    const { authAdapter } = loadRepositories();
    const saida = authAdapter.signOut();

    await jest.advanceTimersByTimeAsync(6_000);

    // Antes, esta era a espera sem fim que deixava a interface logada.
    await expect(saida).resolves.toBeUndefined();
  });

  it('estourado o prazo com a sessão viva, avisa em vez de fingir', async () => {
    jest.useFakeTimers();
    mockAuth.signOut.mockReturnValue(pendurada());
    mockAuth.getSession.mockResolvedValue(comSessao);

    const { authAdapter } = loadRepositories();
    const saida = authAdapter.signOut();
    const capturado = saida.catch((error: Error) => error);

    await jest.advanceTimersByTimeAsync(6_000);

    const erro = await capturado;
    expect(erro).toBeInstanceOf(Error);
    expect((erro as Error).message).toBe('Não foi possível sair da conta. Tente novamente.');
  });
});
