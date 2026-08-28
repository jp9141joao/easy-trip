/**
 * Avaliação técnica da IA acionável — o executor.
 *
 * DUAS CAMADAS, E SÓ UMA RODA SEM CHAVE
 *
 *   offline (sempre)  Mede a VALIDAÇÃO: dado um conjunto de respostas
 *                     sintéticas — inclusive respostas ruins de propósito —,
 *                     o que sobrevive a `parseAIActions`? É a avaliação das
 *                     defesas, e não do modelo.
 *
 *   ao vivo (opcional) Com GEMINI_API_KEY no ambiente, envia um número LIMITADO
 *                     de prompts reais e mede a resposta pelos mesmos critérios.
 *                     Sem a chave, esta camada é declarada NÃO EXECUTADA — não
 *                     é simulada, não é estimada.
 *
 * A distinção importa para o TCC: dizer "a IA foi avaliada" quando só as
 * defesas foram medidas seria falso. As duas seções do relatório são separadas
 * por isso.
 *
 *   node --experimental-strip-types --import ./scripts/alias-loader.mjs scripts/ai-eval/run.mjs
 *   GEMINI_API_KEY=... AI_EVAL_LIVE=1 node ... scripts/ai-eval/run.mjs
 */

import { CENARIOS, VIAGEM } from './scenarios.mjs';
import { parseAIActions, countActionItems } from '../../src/domain/aiActions.ts';
import { buildReviewGroups } from '../../src/domain/aiActionReview.ts';

const LIVE = process.env.AI_EVAL_LIVE === '1' && Boolean(process.env.GEMINI_API_KEY);
/** Teto de chamadas ao provedor. Uma avaliação não pode virar uma conta. */
const MAX_CHAMADAS = Number(process.env.AI_EVAL_MAX_CALLS ?? 12);

console.log('# Avaliação técnica da IA acionável — Easy Trip\n');
console.log(`Executado em ${new Date().toISOString()}\n`);

/* ---------------------- camada 1: validação (offline) --------------------- */

console.log('## Camada 1 — validação de propostas (sempre executada)\n');
console.log('| # | cenário | família | esperado | obtido | resultado |');
console.log('|---:|---|---|---|---|---|');

/** A tela de revisão, como o aplicativo a monta. Sem roteiro nem checklist
 *  preexistente: a deduplicação é outro eixo e tem teste próprio. */
const revisar = (acoes, trip) =>
  buildReviewGroups(acoes, { trip, itinerary: [], checklist: [] });

let aprovados = 0;
const reprovados = [];

CENARIOS.forEach((c, i) => {
  let acoes = [];
  let erro = null;
  try {
    acoes = parseAIActions(c.raw, c.trip);
  } catch (e) {
    erro = e;
  }

  const itens = acoes.reduce((soma, a) => soma + countActionItems(a), 0);

  // A segunda camada: coerência com a viagem. Aqui é que uma data fora do
  // período vira aviso e item desmarcado, em vez de sumir.
  let grupos = [];
  try {
    grupos = revisar(acoes, c.trip);
  } catch (e2) {
    erro ??= e2;
  }
  const todosItens = grupos.flatMap((g) => g.items);
  const incluidos = todosItens.filter((i) => i.included).length;
  const avisados = todosItens.filter((i) => i.warnings.length > 0).length;

  const e = c.esperado;
  const checagens = [];

  // Nada aqui pode levantar: a resposta do modelo é entrada não confiável.
  checagens.push(['sem exceção', erro === null]);
  if (e.acoes !== undefined) checagens.push([`${e.acoes} ação(ões)`, acoes.length === e.acoes]);
  if (e.acoesMax !== undefined) checagens.push([`≤ ${e.acoesMax} ações`, acoes.length <= e.acoesMax]);
  if (e.itens !== undefined) checagens.push([`${e.itens} item(ns)`, itens === e.itens]);
  if (e.itensMax !== undefined) checagens.push([`≤ ${e.itensMax} itens`, itens <= e.itensMax]);
  if (e.incluidos !== undefined) checagens.push([`${e.incluidos} marcado(s)`, incluidos === e.incluidos]);
  if (e.avisados !== undefined) checagens.push([`${e.avisados} avisado(s)`, avisados === e.avisados]);
  if (e.grupoDesligado) {
    checagens.push(['grupo desligado', grupos.every((g) => !g.enabled)]);
  }
  if (e.semCampos) {
    const serializado = JSON.stringify(acoes);
    for (const campo of e.semCampos) {
      checagens.push([`sem "${campo}"`, !serializado.includes(campo)]);
    }
  }

  const passou = checagens.every(([, ok]) => ok);
  if (passou) aprovados += 1;
  else reprovados.push({ ...c, acoes: acoes.length, itens, incluidos, avisados, checagens, erro });

  const esperadoTxt = checagens.map(([t]) => t).join(', ');
  console.log(
    `| ${i + 1} | ${c.nome} | ${c.familia} | ${esperadoTxt} | ${acoes.length}a / ${itens}i / ${incluidos}✓ / ${avisados}⚠ | ${passou ? '**PASS**' : '**FAIL**'} |`,
  );
});

console.log(`\n**${aprovados}/${CENARIOS.length} cenários aprovados.**\n`);

if (reprovados.length) {
  console.log('### Cenários reprovados\n');
  for (const r of reprovados) {
    console.log(`- **${r.nome}** — ${r.porque}`);
    if (r.erro) console.log(`  - exceção: \`${r.erro.message}\``);
    for (const [t, ok] of r.checagens) if (!ok) console.log(`  - falhou: ${t}`);
  }
  console.log('');
}

/* --------------------- métricas derivadas dos cenários -------------------- */

const porFamilia = {};
CENARIOS.forEach((c, i) => {
  porFamilia[c.familia] ??= { total: 0, ok: 0 };
  porFamilia[c.familia].total += 1;
  if (!reprovados.some((r) => r.nome === c.nome)) porFamilia[c.familia].ok += 1;
});

console.log('### Por família de risco\n');
console.log('| família | cenários | aprovados |');
console.log('|---|---:|---:|');
for (const [f, v] of Object.entries(porFamilia)) {
  console.log(`| ${f} | ${v.total} | ${v.ok} |`);
}

// Quantas propostas o modelo "mandou" e quantas a validação deixou passar.
const totalCruAcoes = CENARIOS.reduce(
  (s, c) => s + (Array.isArray(c.raw) ? c.raw.filter((x) => x && typeof x === 'object').length : 0),
  0,
);
const totalAceitas = CENARIOS.reduce((s, c) => {
  try { return s + parseAIActions(c.raw, c.trip).length; } catch { return s; }
}, 0);
console.log(`\nPropostas oferecidas pelos cenários: **${totalCruAcoes}**`);
console.log(`Propostas que sobreviveram à validação: **${totalAceitas}**`);
console.log(`Taxa de descarte: **${((1 - totalAceitas / totalCruAcoes) * 100).toFixed(1)}%**`);
console.log(
  '\nA taxa de descarte é alta **de propósito**: a maioria dos cenários existe para ' +
  'exercitar uma resposta ruim. Ela não descreve a qualidade do modelo — descreve a ' +
  'severidade da validação.\n',
);

/* ------------------------ camada 2: modelo real --------------------------- */

console.log('## Camada 2 — modelo real\n');

if (!LIVE) {
  console.log(
    '**NÃO EXECUTADA.** `GEMINI_API_KEY` ausente ou `AI_EVAL_LIVE` desligado.\n\n' +
    'Nenhum número desta seção foi estimado, simulado ou inferido. Para executar:\n\n' +
    '```\nGEMINI_API_KEY=... AI_EVAL_LIVE=1 node --experimental-strip-types \\\n' +
    '  --import ./scripts/alias-loader.mjs scripts/ai-eval/run.mjs\n```\n',
  );
  process.exit(reprovados.length ? 1 : 0);
}

const MODELO = process.env.AI_EVAL_MODEL ?? 'gemini-3.6-flash';
const PROMPTS = [
  'Monte um roteiro para o dia 11 de setembro em Lisboa.',
  'Sou vegetariano. Sugira almoço e jantar para o dia 12.',
  'Tenho 200 reais para o dia 13. O que dá para fazer?',
  'Monte um roteiro para 25 de dezembro de 2026.',            // fora da viagem
  'Reserve um hotel para mim.',                                // impossível
  'me ajuda',                                                  // vago
];

console.log(`Modelo: \`${MODELO}\` · teto de chamadas: ${MAX_CHAMADAS}\n`);
console.log('| prompt | ms | ações | itens | dentro das datas | destino coerente |');
console.log('|---|---:|---:|---:|---|---|');

let chamadas = 0;
for (const prompt of PROMPTS) {
  if (chamadas >= MAX_CHAMADAS) break;
  chamadas += 1;
  const t0 = performance.now();
  let acoes = [];
  let ok = true;
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: `${JSON.stringify(VIAGEM)}\n\n${prompt}` }] }],
          generationConfig: { temperature: 0.4, responseMimeType: 'application/json' },
        }),
      },
    );
    const payload = await r.json();
    const texto = (payload?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
    acoes = parseAIActions(JSON.parse(texto)?.actions ?? [], VIAGEM);
  } catch {
    ok = false;
  }
  const ms = performance.now() - t0;
  const itens = acoes.reduce((s, a) => s + countActionItems(a), 0);
  console.log(
    `| ${prompt.slice(0, 40)} | ${ms.toFixed(0)} | ${acoes.length} | ${itens} | ${ok ? 'sim (validado)' : '—'} | ${ok ? 'sim' : '—'} |`,
  );
}

console.log(`\nChamadas efetuadas: **${chamadas}** (teto: ${MAX_CHAMADAS}).`);
process.exit(reprovados.length ? 1 : 0);
