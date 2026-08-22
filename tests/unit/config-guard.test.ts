/**
 * A chave secreta que não pode entrar no aplicativo (F10, §18).
 *
 * Este é o erro mais fácil de cometer em todo o projeto: no painel do Supabase a
 * chave publicável e a secreta ficam lado a lado, com nomes parecidos. Colar a
 * errada em `EXPO_PUBLIC_SUPABASE_ANON_KEY` **não quebra nada visível** — o
 * aplicativo conecta, entra em modo produção e funciona. O que muda é que a Row
 * Level Security deixa de valer para qualquer pessoa que tenha o APK, porque
 * `service_role` a ignora por definição.
 *
 * Por isso o teste existe: o comportamento correto é contraintuitivo (a chave
 * é **descartada**, e o aplicativo cai em modo demonstração) e nenhuma tela
 * denunciaria a troca sozinha.
 *
 * `config.ts` lê `process.env` no carregamento do módulo, então cada cenário
 * precisa reimportá-lo com o ambiente já montado.
 */

type Config = typeof import('@/lib/config');

function loadConfig(env: Record<string, string | undefined>): Config {
  let loaded!: Config;
  jest.isolateModules(() => {
    const previous = { ...process.env };
    Object.assign(process.env, env);
    loaded = require('@/lib/config') as Config;
    process.env = previous;
  });
  return loaded;
}

const URL = 'https://projeto.supabase.co';
/** JWT sem assinatura válida — o que importa é o que o payload afirma ser. */
const jwt = (role: string) =>
  `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.assinatura`;

describe('chave publicável x chave secreta', () => {
  it('aceita a chave publicável no formato atual', () => {
    const config = loadConfig({
      EXPO_PUBLIC_SUPABASE_URL: URL,
      EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_abc123',
    });

    expect(config.hasSupabase).toBe(true);
    expect(config.config.mode).toBe('production');
    expect(config.configIssues).toEqual([]);
  });

  it('aceita a chave anônima no formato legado (JWT)', () => {
    const config = loadConfig({
      EXPO_PUBLIC_SUPABASE_URL: URL,
      EXPO_PUBLIC_SUPABASE_ANON_KEY: jwt('anon'),
    });

    expect(config.hasSupabase).toBe(true);
    expect(config.configIssues).toEqual([]);
  });

  it('DESCARTA a chave secreta no formato atual e explica o motivo', () => {
    const config = loadConfig({
      EXPO_PUBLIC_SUPABASE_URL: URL,
      EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_secret_abc123',
    });

    // O ponto do teste: não é um aviso com o aplicativo funcionando. A chave
    // não é usada, e por isso o modo cai para demonstração.
    expect(config.hasSupabase).toBe(false);
    expect(config.config.supabaseAnonKey).toBe('');
    expect(config.configIssues.join(' ')).toMatch(/SECRETA/);
  });

  it('DESCARTA a chave `service_role` no formato legado (JWT)', () => {
    const config = loadConfig({
      EXPO_PUBLIC_SUPABASE_URL: URL,
      EXPO_PUBLIC_SUPABASE_ANON_KEY: jwt('service_role'),
    });

    expect(config.hasSupabase).toBe(false);
    expect(config.config.supabaseAnonKey).toBe('');
    expect(config.configIssues.join(' ')).toMatch(/SECRETA/);
  });
});

describe('configuração pela metade', () => {
  it('avisa quando há URL sem chave', () => {
    const config = loadConfig({
      EXPO_PUBLIC_SUPABASE_URL: URL,
      EXPO_PUBLIC_SUPABASE_ANON_KEY: '',
    });

    expect(config.hasSupabase).toBe(false);
    expect(config.configIssues.join(' ')).toMatch(/ANON_KEY não/);
  });

  it('avisa quando há chave sem URL', () => {
    const config = loadConfig({
      EXPO_PUBLIC_SUPABASE_URL: '',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_abc123',
    });

    expect(config.hasSupabase).toBe(false);
    expect(config.configIssues.join(' ')).toMatch(/URL não/);
  });

  it('não reclama do modo demonstração puro — não configurar nada é legítimo', () => {
    const config = loadConfig({
      EXPO_PUBLIC_SUPABASE_URL: '',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: '',
      EXPO_PUBLIC_BFF_URL: '',
    });

    expect(config.config.mode).toBe('demo');
    expect(config.configIssues).toEqual([]);
  });

  it('BFF ausente é funcionalidade desligada, não defeito de instalação', () => {
    const config = loadConfig({
      EXPO_PUBLIC_SUPABASE_URL: URL,
      EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_abc123',
      EXPO_PUBLIC_BFF_URL: '',
    });

    expect(config.hasBff).toBe(false);
    expect(config.configIssues).toEqual([]);
  });
});
