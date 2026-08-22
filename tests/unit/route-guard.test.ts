import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * F4 — nenhuma rota entra no aplicativo sem ser classificada.
 *
 * A proteção real está em `src/app/_layout.tsx`, com `Stack.Protected`. O
 * problema de uma lista escrita à mão é que ela envelhece em silêncio: quem
 * criar `src/app/relatorios/` daqui a três meses ganha uma rota pública sem
 * perceber, e nada quebra.
 *
 * Este teste é a trava contra isso. Ele lê o diretório de rotas de verdade e
 * exige que cada uma esteja de um lado ou do outro da porta. Rota nova sem
 * classificação = suíte vermelha.
 */

const APP_DIR = join(__dirname, '..', '..', 'src', 'app');
const LAYOUT = readFileSync(join(APP_DIR, '_layout.tsx'), 'utf8');

/** Nomes de rota que o Expo Router enxerga na raiz de `src/app`. */
function rootRoutes(): string[] {
  return readdirSync(APP_DIR, { withFileTypes: true })
    .map((entry) => (entry.isDirectory() ? entry.name : entry.name.replace(/\.tsx$/, '')))
    .filter((name) => !name.startsWith('_') && name !== 'index');
}

/** Nomes declarados dentro de um bloco `<Stack.Protected guard={…}>`. */
function declaredUnder(guard: string): string[] {
  const block = new RegExp(
    `<Stack\\.Protected guard=\\{${guard.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}>([\\s\\S]*?)</Stack\\.Protected>`,
  ).exec(LAYOUT);
  if (!block) return [];
  return [...block[1].matchAll(/name="([^"]+)"/g)].map((match) => match[1]);
}

const PUBLIC_ROUTES = declaredUnder('!isAuthenticated');
const PRIVATE_ROUTES = declaredUnder('isAuthenticated');

describe('proteção de rotas', () => {
  it('separa as rotas em públicas e privadas', () => {
    // Se um dos blocos sumir, tudo o mais neste arquivo passaria a comparar
    // listas vazias e daria verde sem proteger nada.
    expect(PUBLIC_ROUTES.length).toBeGreaterThan(0);
    expect(PRIVATE_ROUTES.length).toBeGreaterThan(0);
  });

  it('classifica toda rota existente', () => {
    const classificadas = new Set([...PUBLIC_ROUTES, ...PRIVATE_ROUTES]);
    const semClassificacao = rootRoutes().filter((route) => !classificadas.has(route));

    expect(semClassificacao).toEqual([]);
  });

  it('mantém privadas as áreas que tratam dados pessoais', () => {
    // A lista do pedido da F4, conferida contra a estrutura real de rotas.
    for (const route of ['(tabs)', 'trip', 'trips', 'profile', 'utilities', 'alerts', 'admin']) {
      expect(PRIVATE_ROUTES).toContain(route);
    }
  });

  it('mantém privado o conteúdo editorial, que a RLS só serve a quem tem sessão', () => {
    // `articles`, `offers` e `places` são legíveis apenas por `authenticated`
    // (0002/0004). Deixar as telas públicas renderizaria listas vazias e
    // esconderia a causa.
    for (const route of ['community', 'offers', 'places']) {
      expect(PRIVATE_ROUTES).toContain(route);
    }
  });

  it('deixa fora da área autenticada só o que precisa estar', () => {
    expect(PUBLIC_ROUTES.sort()).toEqual(['(auth)', 'onboarding']);
  });

  it('não classifica a mesma rota dos dois lados', () => {
    const duplicadas = PRIVATE_ROUTES.filter((route) => PUBLIC_ROUTES.includes(route));
    expect(duplicadas).toEqual([]);
  });
});

describe('sessão de recuperação', () => {
  const AUTH_LAYOUT = readFileSync(join(APP_DIR, '(auth)', '_layout.tsx'), 'utf8');

  it('isola a tela de redefinição do resto do fluxo de entrada', () => {
    // Com `recoveryPending`, entrar e cadastrar saem do navegador: a sessão que
    // veio do e-mail serve para trocar a senha, e para mais nada.
    expect(AUTH_LAYOUT).toMatch(/<Stack\.Protected guard=\{recoveryPending\}>/);
    expect(AUTH_LAYOUT).toMatch(/<Stack\.Protected guard=\{!recoveryPending\}>/);
  });
});
