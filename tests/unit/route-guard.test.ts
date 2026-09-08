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

/**
 * Nomes de rota que o Expo Router enxerga na raiz de `src/app`.
 *
 * NÃO É A LISTA DE DIRETÓRIOS — e a diferença era um defeito real.
 *
 * Um diretório só vira um nó de rota quando tem `_layout.tsx`. Sem ele, os
 * arquivos de dentro sobem para o navegador da raiz com o caminho inteiro no
 * nome: `trips/new`, `utilities/map`, `trip/[tripId]`. Enquanto este teste
 * comparava nomes de DIRETÓRIO, ele dava verde para
 * `<Stack.Screen name="trips" />` — um nome que não casa com rota nenhuma,
 * que o Expo Router recusava com `[Layout children]: No route named "trips"`,
 * e que portanto deixava `trips/new` fora do bloco protegido.
 */
function rootRoutes(): string[] {
  const walk = (dir: string, prefix: string): string[] => {
    const entries = readdirSync(dir, { withFileTypes: true });

    // Diretório com layout é um nó só: o que existe lá dentro é registrado
    // pelo navegador de lá, e não por este.
    if (prefix && entries.some((entry) => entry.isFile() && entry.name === '_layout.tsx')) {
      return [prefix.replace(/\/$/, '')];
    }

    const found: string[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith('_')) continue;
      if (entry.isDirectory()) {
        found.push(...walk(join(dir, entry.name), `${prefix}${entry.name}/`));
      } else if (entry.name.endsWith('.tsx')) {
        found.push(`${prefix}${entry.name.replace(/\.tsx$/, '')}`);
      }
    }
    return found;
  };

  return walk(APP_DIR, '').filter((name) => name !== 'index');
}

/** As rotas reais que vivem sob uma área. `alerts` é um arquivo, não pasta. */
function routesUnder(area: string): string[] {
  return rootRoutes().filter((route) =>
    area.endsWith('/') ? route.startsWith(area) : route === area,
  );
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

  it('só declara nomes que o Expo Router registra de fato', () => {
    /*
     * O outro lado da mesma porta, e o que faltava.
     *
     * O teste acima garante que nenhuma rota fique de fora da lista. Este
     * garante que nada na lista aponte para o vazio — que era o caso de
     * `trip`, `trips` e `utilities`, os três avisos
     * `[Layout children]: No route named "…"` do console.
     *
     * O nome tem de ser EXATO. O Expo Router também aceita `X` para a rota
     * `X/index`, e é justamente esse atalho que fazia `name="profile"`
     * parecer suficiente enquanto `profile/settings` e `profile/sync`
     * continuavam registradas fora do bloco protegido.
     */
    const reais = new Set([...rootRoutes(), 'index']);
    const inexistentes = [...PUBLIC_ROUTES, ...PRIVATE_ROUTES].filter(
      (name) => !reais.has(name),
    );

    expect(inexistentes).toEqual([]);
  });

  it('mantém privadas as áreas que tratam dados pessoais', () => {
    // A lista do pedido da F4, conferida contra a estrutura real de rotas.
    // Por ÁREA, e não por rota escolhida a dedo: uma tela nova dentro de
    // `utilities/` nasce coberta em vez de depender de alguém lembrar dela.
    for (const area of ['(tabs)', 'alerts', 'admin', 'trip/', 'trips/', 'profile/', 'utilities/']) {
      const rotas = routesUnder(area);
      // Área que sumiu passaria vacuamente, sem proteger nada.
      expect(rotas.length).toBeGreaterThan(0);
      for (const route of rotas) expect(PRIVATE_ROUTES).toContain(route);
    }
  });

  it('mantém privado o conteúdo editorial, que a RLS só serve a quem tem sessão', () => {
    // `articles`, `offers` e `places` são legíveis apenas por `authenticated`
    // (0002/0004). Deixar as telas públicas renderizaria listas vazias e
    // esconderia a causa. Inclui as rotas de detalhe: era `[articleId]`,
    // `[offerId]` e `[placeId]` que ficavam de fora quando a lista usava
    // apenas o nome do diretório.
    for (const area of ['community/', 'offers/', 'places/']) {
      const rotas = routesUnder(area);
      expect(rotas.length).toBeGreaterThan(0);
      for (const route of rotas) expect(PRIVATE_ROUTES).toContain(route);
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
