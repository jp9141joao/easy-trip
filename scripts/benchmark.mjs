/**
 * Medição de desempenho do Easy Trip — o que dá para medir de verdade.
 *
 * O QUE ESTE ARQUIVO NÃO É
 *
 * Não é um benchmark de aplicativo. Ele não mede tempo de abertura, taxa de
 * quadros, consumo de memória em aparelho nem latência percebida — nada disso é
 * mensurável sem um Android instrumentado, e inventar número para essas coisas
 * seria pior do que não tê-las.
 *
 * O que ELE mede são duas famílias de coisa, ambas reprodutíveis nesta máquina:
 *
 *   1. funções de domínio puras — cálculo financeiro, derivação de alertas,
 *      ordenação de roteiro, rota do dia, fila offline. São o trabalho que roda
 *      na thread de JavaScript a cada render, e o que as torna interessantes é
 *      que o custo delas CRESCE com o tamanho da viagem.
 *
 *   2. operações do backend não destrutivas contra a pilha LOCAL — leitura por
 *      PostgREST com RLS avaliada. Não toca produção e não escreve nada.
 *
 * METODOLOGIA
 *
 * Cada caso roda N vezes depois de um aquecimento descartado (a primeira
 * execução paga compilação JIT e alocação inicial, e incluí-la faria a média
 * descrever o aquecimento em vez do trabalho). Reportamos N, média, mediana e
 * p95 — a média sozinha esconde a cauda, e é a cauda que o usuário sente.
 *
 *   node scripts/benchmark.mjs
 *   node scripts/benchmark.mjs --json > PERFORMANCE.json
 */

import { performance } from 'node:perf_hooks';

const JSON_OUT = process.argv.includes('--json');
const log = (...args) => { if (!JSON_OUT) console.log(...args); };

/* ------------------------------ instrumento ------------------------------- */

const AQUECIMENTO = 20;

function medir(nome, fn, amostras = 200) {
  for (let i = 0; i < AQUECIMENTO; i += 1) fn();

  const tempos = [];
  for (let i = 0; i < amostras; i += 1) {
    const t0 = performance.now();
    fn();
    tempos.push(performance.now() - t0);
  }
  tempos.sort((a, b) => a - b);

  const soma = tempos.reduce((a, b) => a + b, 0);
  return {
    nome,
    n: amostras,
    media: soma / amostras,
    mediana: tempos[Math.floor(amostras / 2)],
    p95: tempos[Math.floor(amostras * 0.95)],
    min: tempos[0],
    max: tempos[amostras - 1],
  };
}

async function medirAsync(nome, fn, amostras = 30) {
  for (let i = 0; i < 3; i += 1) await fn();

  const tempos = [];
  for (let i = 0; i < amostras; i += 1) {
    const t0 = performance.now();
    await fn();
    tempos.push(performance.now() - t0);
  }
  tempos.sort((a, b) => a - b);
  const soma = tempos.reduce((a, b) => a + b, 0);
  return {
    nome,
    n: amostras,
    media: soma / amostras,
    mediana: tempos[Math.floor(amostras / 2)],
    p95: tempos[Math.floor(amostras * 0.95)],
    min: tempos[0],
    max: tempos[amostras - 1],
  };
}

const ms = (v) => `${v.toFixed(4)} ms`;

/**
 * Importa um módulo do aplicativo, e RECLAMA se não der.
 *
 * Um `catch(() => null)` silencioso aqui produziria um relatório com uma seção
 * a menos e nenhuma explicação — que é a pior forma de um benchmark falhar,
 * porque o número ausente não chama atenção.
 */
async function carregar(caminho) {
  try {
    return await import(caminho);
  } catch (erro) {
    console.error(`\n!! NÃO MEDIDO: ${caminho}\n   ${erro.message}\n`);
    return null;
  }
}

function tabela(titulo, linhas) {
  log(`\n### ${titulo}\n`);
  log('| caso | N | média | mediana | p95 | máx |');
  log('|---|---:|---:|---:|---:|---:|');
  for (const r of linhas) {
    log(`| ${r.nome} | ${r.n} | ${ms(r.media)} | ${ms(r.mediana)} | ${ms(r.p95)} | ${ms(r.max)} |`);
  }
}

/* --------------------------------- dados ---------------------------------- */

/**
 * Viagens sintéticas de três tamanhos.
 *
 * Os números não são arbitrários: 30 despesas é uma viagem curta real, 300 é
 * uma viagem longa de alguém que registra tudo, e 3.000 é o limite superior
 * plausível de um usuário intenso ao longo de anos. Medir só o caso pequeno
 * esconderia exatamente o crescimento que interessa.
 */
const CATEGORIAS = ['hospedagem', 'alimentacao', 'transporte', 'lazer', 'compras', 'outros'];

function viagem() {
  return {
    id: 't1',
    userId: 'u1',
    destinationCity: 'Lisboa',
    destinationCountry: 'Portugal',
    countryCode: 'PT',
    timezone: 'Europe/Lisbon',
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    budgetTotal: 20000,
    budgetCurrency: 'BRL',
    dailySpendingGoal: 500,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

function despesas(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `e${i}`,
    tripId: 't1',
    userId: 'u1',
    category: CATEGORIAS[i % CATEGORIAS.length],
    amount: 50 + (i % 400),
    currency: i % 5 === 0 ? 'EUR' : 'BRL',
    amountInBudgetCurrency: i % 7 === 0 ? undefined : 50 + (i % 400),
    transactionDate: `2026-09-${String((i % 30) + 1).padStart(2, '0')}`,
    description: `Despesa ${i}`,
    visibility: i % 3 === 0 ? 'private' : 'shared',
    createdBy: 'u1',
    createdAt: '2026-09-01T00:00:00.000Z',
  }));
}

function roteiro(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `i${i}`,
    tripId: 't1',
    userId: 'u1',
    date: `2026-09-${String((i % 30) + 1).padStart(2, '0')}`,
    startTime: `${String(8 + (i % 12)).padStart(2, '0')}:00`,
    title: `Atividade ${i}`,
    placeName: `Lugar ${i}`,
    latitude: 38.7 + (i % 100) / 1000,
    longitude: -9.1 + (i % 100) / 1000,
    visibility: 'shared',
    createdBy: 'u1',
  }));
}

/* -------------------------------- execução -------------------------------- */

const resultados = {};

log('# Medição de desempenho — Easy Trip');
log(`\nNode ${process.version} · ${new Date().toISOString()}`);
log(`\nAquecimento descartado: ${AQUECIMENTO} execuções por caso.`);

// -------- 1. domínio: cálculo financeiro --------
{
  const selectors = await carregar('../src/domain/selectors.ts');
  if (selectors) {
    const t = viagem();
    const linhas = [];
    for (const n of [30, 300, 3000]) {
      const e = despesas(n);
      linhas.push(medir(`getTripTotalSpent · ${n} despesas`, () => selectors.getTripTotalSpent(e, t)));
      linhas.push(medir(`getExpensesByCategory · ${n}`, () => selectors.getExpensesByCategory(e, t)));
      linhas.push(medir(`getDailySpend · ${n}`, () => selectors.getDailySpend(e, t)));
      linhas.push(medir(`getExceededGoalDays · ${n}`, () => selectors.getExceededGoalDays(e, t)));
    }
    for (const n of [50, 500]) {
      const items = roteiro(n);
      linhas.push(medir(`sortItinerary · ${n} itens`, () => selectors.sortItinerary(items)));
    }
    tabela('1. Cálculo financeiro e ordenação (domínio puro)', linhas);
    resultados.dominio = linhas;
  }
}

// -------- 2. domínio: rota do dia --------
{
  const route = await carregar('../src/domain/route.ts');
  if (route) {
    const linhas = [];
    for (const n of [5, 12, 30]) {
      const items = roteiro(200).filter((_, i) => i < n).map((it) => ({ ...it, date: '2026-09-01' }));
      linhas.push(medir(`buildDayRoute · ${n} paradas`, () => route.buildDayRoute(items, '2026-09-01')));
    }
    tabela('2. Rota do dia (Haversine encadeado)', linhas);
    resultados.rota = linhas;
  }
}

// -------- 3. fila offline --------
{
  const q = await carregar('../src/domain/offlineQueue.ts');
  if (q) {
    const linhas = [];
    const agora = '2026-08-28T12:00:00.000Z';
    for (const n of [10, 100, 500]) {
      let fila = [];
      for (let i = 0; i < n; i += 1) {
        fila = q.enqueue(fila, {
          id: `q${i}`, userId: 'u1', entity: 'expense', operation: 'create',
          targetId: `e${i}`, tripId: 't1', payload: { amount: i },
        }, agora);
      }
      linhas.push(medir(`drainableFor · fila de ${n}`, () => q.drainableFor(fila, 'u1', agora)));
      linhas.push(medir(`summarize · fila de ${n}`, () => q.summarize(fila, 'u1')));
      linhas.push(medir(`enqueue (dobra) · fila de ${n}`, () =>
        q.enqueue(fila, {
          id: 'novo', userId: 'u1', entity: 'expense', operation: 'update',
          targetId: 'e0', payload: { amount: 999 },
        }, agora)));
    }
    tabela('3. Fila offline', linhas);
    resultados.fila = linhas;
  }
}

// -------- 4. backend local, somente leitura --------
{
  const API = process.env.SUPABASE_API_URL;
  const ANON = process.env.SUPABASE_ANON_KEY;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (API && ANON && SERVICE && /127\.0\.0\.1|localhost/.test(API)) {
    const svc = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` };
    const linhas = [];

    const get = (path, headers) => async () => {
      const r = await fetch(`${API}/rest/v1/${path}`, { headers });
      await r.text();
    };

    linhas.push(await medirAsync('GET /articles?limit=20 (anon)', get('articles?select=id,title&limit=20', { apikey: ANON })));
    linhas.push(await medirAsync('GET /trips (service role)', get('trips?select=id&limit=50', svc)));
    linhas.push(await medirAsync('GET /expenses (service role)', get('expenses?select=id,amount&limit=100', svc)));
    linhas.push(await medirAsync('RPC is_trip_member (RLS helper)', async () => {
      const r = await fetch(`${API}/rest/v1/rpc/is_trip_member`, {
        method: 'POST',
        headers: { ...svc, 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_trip: '00000000-0000-4000-8000-000000000000' }),
      });
      await r.text();
    }));

    tabela('4. Backend local — leitura por PostgREST com RLS (nada é escrito)', linhas);
    resultados.backend = linhas;
  } else {
    log('\n### 4. Backend local\n\nNÃO MEDIDO: a pilha local não estava no ar (SUPABASE_API_URL ausente ou não local).');
    resultados.backend = null;
  }
}

if (JSON_OUT) {
  console.log(JSON.stringify({ node: process.version, at: new Date().toISOString(), resultados }, null, 2));
} else {
  log('\n---\n');
  log('O que NÃO foi medido, e por quê, está em PERFORMANCE_BASELINE.md.');
}
