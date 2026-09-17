/**
 * CONSULTAR NÃO É CRIAR.
 *
 * Este arquivo existe por causa de um defeito concreto: "Liste, sem criar
 * nada, o que tenho planejado no roteiro do dia 18" voltava com um roteiro
 * NOVO e o cartão "Revisar antes de adicionar". A causa não foi o modelo — foi
 * o classificador do servidor, que casava a palavra `roteiro` e concluía que a
 * pessoa queria um roteiro montado. Isso confunde ASSUNTO com INTENÇÃO.
 *
 * O modelo aqui separa as duas coisas:
 *
 *   ASSUNTO   (`domains`)    roteiro, checklist, despesa, orçamento, meta, diário
 *   OPERAÇÃO  (`operation`)  read | write | ambiguous
 *
 * Citar "roteiro" diz sobre o QUÊ a pessoa fala. Só o verbo — e a negação em
 * volta dele — diz o QUE ela quer que aconteça.
 *
 * A PRECEDÊNCIA É FIXA E DELIBERADA:
 *
 *   1. explicitReadOnly  "não crie", "sem adicionar", "só me mostre"
 *   2. explicitWrite     "monte", "crie", "adicione"
 *   3. readSignal        "liste", "quais", "o que tenho", "quanto falta"
 *   4. ambiguous         nada decidiu
 *
 * O item 1 vence o 2 de propósito, e isso tem um custo assumido: "crie uma
 * meta sem alterar o orçamento" é lido como leitura. É o lado seguro do erro —
 * uma consulta a mais nunca grava nada, uma escrita a mais grava. Na dúvida
 * (item 4) TAMBÉM não se muta: quem decide o contrário é o servidor, com a
 * promoção explícita de `classifyRequestIntent`.
 *
 * NÃO HÁ HEURÍSTICA DE FRASE INTEIRA AQUI. O texto é reduzido a tokens
 * normalizados (sem acento, sem caixa, sem pontuação, com gírias expandidas) e
 * o que decide é o léxico mais uma janela curta de vizinhança — negação,
 * restrição e marcador descritivo. Não é uma lista de frases especiais, e uma
 * frase nova do mesmo tipo cai na mesma categoria sem alteração de código.
 *
 * O ESPELHO DO CLIENTE está em `src/domain/aiIntent.ts`, deliberadamente
 * independente (o aplicativo precisa se defender de uma Function ainda não
 * publicada). `tests/unit/ai-intent-parity.test.ts` roda o MESMO corpus nos
 * dois e reprova se eles divergirem.
 */

export type AIIntentDomain =
  | 'itinerary'
  | 'checklist'
  | 'expense'
  | 'budget'
  | 'goal'
  | 'journal';

export type AIIntentOperation = 'read' | 'write' | 'ambiguous';

export interface IntentAnalysis {
  /** O ASSUNTO. Não autoriza nada — só diz de que a pessoa está falando. */
  domains: AIIntentDomain[];
  /** O que fazer com a resposta do modelo. */
  operation: AIIntentOperation;
  /** "não crie", "sem adicionar", "só me mostre" — bloqueia qualquer action. */
  explicitReadOnly: boolean;
  /** Um verbo de criação/alteração no imperativo ou infinitivo, sem negação. */
  explicitWrite: boolean;
  /** Verbo de consulta, interrogativo, particípio de estado, "o que tenho". */
  readSignal: boolean;
  /** A única pergunta que o resto do sistema faz a este módulo. */
  allowsMutation: boolean;
}

/* ------------------------------ normalização ------------------------------ */

/**
 * O português real do aplicativo — "oq", "pra", "vc", "add".
 *
 * A expansão acontece por TOKEN, e não por busca no texto: `q` sozinho vira
 * `que`, mas o `q` dentro de "quero" não é tocado. Sem isto, "me mostra oq vou
 * fazer" não casaria com nada e cairia em `ambiguous`.
 */
const SLANG: Record<string, string> = {
  oq: 'o que',
  oque: 'o que',
  oqe: 'o que',
  q: 'que',
  pq: 'porque',
  pra: 'para',
  pro: 'para',
  vc: 'voce',
  vcs: 'voces',
  tbm: 'tambem',
  tb: 'tambem',
  ta: 'esta',
  tao: 'estao',
  to: 'estou',
  vdd: 'verdade',
  add: 'adicionar',
  qnt: 'quanto',
  qto: 'quanto',
  qts: 'quantos',
  qdo: 'quando',
  hj: 'hoje',
  amanha: 'amanha',
};

/** minúsculas, sem acento, sem pontuação, com gíria expandida. */
export function tokenizeIntent(text: string): string[] {
  const folded = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  if (!folded) return [];

  const tokens: string[] = [];
  for (const word of folded.split(' ')) {
    const expanded = SLANG[word];
    if (expanded) tokens.push(...expanded.split(' '));
    else tokens.push(word);
  }
  return tokens;
}

/* --------------------------------- léxico --------------------------------- */

/**
 * LER. Imperativo, infinitivo e a terceira pessoa que vira imperativo na fala
 * ("confere meu roteiro", "ve meu roteiro").
 *
 * `revise` NÃO entra: é a palavra que o próprio assistente usa para o fluxo de
 * proposta ("revise e confirme"), e lê-la como consulta trocaria o sentido de
 * uma confirmação.
 */
const READ_VERBS = new Set([
  'liste', 'listar', 'lista', 'listem', 'listando',
  'mostre', 'mostrar', 'mostra', 'mostrem', 'mostrando',
  'veja', 'ver', 've', 'vejam', 'vendo',
  'verifique', 'verificar', 'verifica', 'verificando',
  'confira', 'conferir', 'confere', 'checar', 'cheque', 'checa',
  'consulte', 'consultar', 'consulta',
  'resuma', 'resumir', 'resume', 'resumo',
  'diga', 'dizer', 'diz', 'fale', 'falar', 'fala',
  'informe', 'informar', 'informa',
  'explique', 'explicar', 'explica',
  'compare', 'comparar', 'compara',
  'analise', 'analisar', 'analisa',
  'saber', 'lembre', 'lembra', 'relembre',
]);

/**
 * ESCREVER. Verbos que, no imperativo ou no infinitivo, pedem que algo passe a
 * existir ou mude.
 *
 * `fazer`/`faz`/`faca` estão aqui porque "me faz um roteiro" e "o que fazer
 * amanhã" são pedidos de proposta. É também o verbo mais perigoso da lista —
 * ver `DESCRIPTIVE_MARKERS`, que é o que separa "o que fazer" de "o que VOU
 * fazer".
 */
const WRITE_VERBS = new Set([
  'crie', 'criar', 'cria', 'criem',
  'monte', 'montar', 'monta', 'montem',
  'adicione', 'adicionar', 'adiciona', 'adicionem',
  'insira', 'inserir', 'insere',
  'registre', 'registrar', 'registra',
  'gere', 'gerar', 'gera',
  'planeje', 'planejar', 'planeja',
  'organize', 'organizar', 'organiza',
  'prepare', 'preparar', 'prepara',
  'atualize', 'atualizar', 'atualiza',
  'defina', 'definir', 'define',
  'altere', 'alterar', 'altera',
  'mude', 'mudar', 'muda',
  'troque', 'trocar', 'troca',
  'inclua', 'incluir', 'inclui',
  'coloque', 'colocar', 'coloca', 'ponha', 'poe',
  'escreva', 'escrever', 'escreve', 'redija', 'redigir',
  'anote', 'anotar', 'anota',
  'lance', 'lancar', 'lanca',
  'sugira', 'sugerir', 'sugere',
  'recomende', 'recomendar', 'recomenda',
  'indique', 'indicar', 'indica',
  'marque', 'marcar',
  'agende', 'agendar',
  'salve', 'salvar', 'grave', 'gravar',
  'remova', 'remover', 'apague', 'apagar', 'exclua', 'excluir',
  'estime', 'estimar',
  'faca', 'facam', 'fazer', 'faz', 'faco',
]);

/**
 * OS VERBOS QUE, NEGADOS, VIRAM UMA PROIBIÇÃO EXPLÍCITA.
 *
 * É um subconjunto de `WRITE_VERBS`, e a diferença importa. "Monte um roteiro
 * sem fazer nada caro" não é um pedido de leitura — `fazer` ficou de fora
 * justamente para que a preposição `sem`, que é comum em qualquer frase, não
 * transforme um pedido legítimo em consulta. Já "sem criar", "não adicione",
 * "não altere" são exatamente o que a pessoa escreve quando quer barrar a
 * gravação, e estão todos aqui.
 */
const BLOCKING_WRITE_VERBS = new Set([
  'crie', 'criar', 'cria',
  'monte', 'montar', 'monta',
  'adicione', 'adicionar', 'adiciona',
  'insira', 'inserir',
  'registre', 'registrar',
  'gere', 'gerar',
  'planeje', 'planejar',
  'organize', 'organizar',
  'prepare', 'preparar',
  'atualize', 'atualizar',
  'defina', 'definir',
  'altere', 'alterar',
  'mude', 'mudar',
  'inclua', 'incluir',
  'coloque', 'colocar',
  'anote', 'anotar',
  'escreva', 'escrever',
  'marque', 'marcar',
  'salve', 'salvar', 'grave', 'gravar',
  'remova', 'remover', 'apague', 'apagar', 'exclua', 'excluir',
  'lance', 'lancar',
  'sugira', 'sugerir',
  'mexa', 'mexer',
]);

const NEGATORS = new Set(['nao', 'nem', 'sem', 'jamais', 'nunca']);

/** "só", "apenas", "somente" — o que transforma uma consulta em proibição. */
const RESTRICTORS = new Set(['so', 'somente', 'apenas', 'unicamente', 'simplesmente']);

/**
 * O QUE FAZ UM VERBO DE ESCRITA DESCREVER EM VEZ DE MANDAR.
 *
 * "o que VOU fazer no dia 18" e "o que fazer no dia 18" carregam o mesmo verbo
 * e pedem coisas opostas: a primeira consulta um plano que já existe, a segunda
 * pede um plano novo. O que as separa é o auxiliar de primeira pessoa (ou o
 * "já") imediatamente antes — quem diz "vou fazer" está relatando, não pedindo.
 */
const DESCRIPTIVE_MARKERS = new Set([
  'vou', 'irei', 'vamos', 'iremos', 'ia', 'iam',
  'pretendo', 'pretendemos',
  'ja', 'tenho', 'temos', 'tinha', 'tinhamos',
  'estava', 'estavam', 'esta', 'estao',
  'foi', 'foram', 'era', 'eram', 'fui', 'sera', 'serao',
]);

/** "quero um roteiro" é pedido; "quero saber" é pergunta. */
const WANT_MARKERS = new Set(['quero', 'queria', 'gostaria', 'quiser']);
const INDEFINITE_ARTICLES = new Set(['um', 'uma', 'uns', 'umas', 'novo', 'nova', 'novos', 'novas']);

/** Interrogativos e palavras de quantidade — sempre pergunta sobre o que existe. */
const QUERY_WORDS = new Set([
  'quais', 'qual', 'quanto', 'quantos', 'quantas', 'quanta',
  'cade', 'quando', 'onde', 'como',
  'gastei', 'gastou', 'gastamos', 'gasto', 'gastos',
  'custou', 'custa', 'paguei',
  'sobrou', 'sobra', 'resta', 'restou', 'restante',
  'falta', 'faltam', 'faltando', 'pendente', 'pendentes',
  'saldo', 'extrato',
]);

/**
 * PARTICÍPIO É ESTADO, NÃO ORDEM (§15 do pedido).
 *
 * "o que tenho planejado" pergunta pelo planejamento que existe. Foi
 * exatamente a palavra que o classificador antigo lia como "planejar algo
 * novo" — e o particípio nunca é imperativo em português.
 */
const STATE_PARTICIPLES = new Set([
  'planejado', 'planejada', 'planejados', 'planejadas',
  'marcado', 'marcada', 'marcados', 'marcadas',
  'agendado', 'agendada', 'agendados', 'agendadas',
  'cadastrado', 'cadastrada', 'cadastrados', 'cadastradas',
  'registrado', 'registrada', 'registrados', 'registradas',
  'adicionado', 'adicionada', 'adicionados', 'adicionadas',
  'salvo', 'salva', 'salvos', 'salvas',
  'previsto', 'prevista', 'previstos', 'previstas',
]);

/**
 * As perguntas que nenhum verbo isolado revela.
 *
 * Casadas contra a sequência de tokens já normalizada — não contra o texto
 * cru —, então "oq tenho" e "O que eu tenho?" chegam aqui iguais.
 */
const READ_PHRASES = [
  'o que tenho', 'o que eu tenho', 'o que temos', 'o que nos temos',
  'o que falta', 'o que ainda falta',
  'o que ja', 'o que eu ja',
  'o que esta', 'o que estao',
  'o que vou', 'o que eu vou', 'o que vamos', 'o que irei',
  'o que tem', 'o que voce tem',
  'ja tem', 'ja esta', 'ja estao', 'ja foi', 'ja existe', 'ja existem',
  'tem algo', 'tem algum', 'tem alguma',
  'meus planos', 'meu plano', 'os planos', 'nossos planos',
];

/** Proibições que não passam pela janela de negação de um verbo só. */
const READ_ONLY_PHRASES = [
  'nada de novo',
  'so consulta', 'apenas consulta', 'somente consulta',
  'so leitura', 'apenas leitura', 'somente leitura',
  'nao quero nada novo',
];

/** O ASSUNTO. Nunca autoriza gravação — ver o cabeçalho. */
const DOMAIN_NOUNS: readonly (readonly [AIIntentDomain, readonly string[]])[] = [
  ['itinerary', [
    'roteiro', 'roteiros', 'itinerario', 'itinerarios',
    'atividade', 'atividades', 'programacao', 'cronograma',
    'passeio', 'passeios', 'parada', 'paradas', 'agenda',
  ]],
  ['checklist', ['checklist', 'checklists', 'pendencia', 'pendencias', 'mala', 'bagagem']],
  ['expense', [
    'despesa', 'despesas', 'gasto', 'gastos', 'gastei', 'gastar',
    'custo', 'custos', 'compra', 'compras',
  ]],
  ['budget', ['orcamento', 'orcamentos', 'saldo', 'budget']],
  ['goal', ['meta', 'metas', 'objetivo', 'objetivos']],
  ['journal', ['diario', 'diarios']],
];

/* -------------------------------- análise --------------------------------- */

/** Quantos tokens antes conta como "perto o bastante para modificar o verbo". */
const NEGATION_WINDOW = 3;
const RESTRICTION_WINDOW = 3;
const DESCRIPTIVE_WINDOW = 2;
const WANT_LOOKAHEAD = 3;

function phrasePresent(padded: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => padded.includes(` ${phrase} `));
}

function detectDomains(tokens: readonly string[]): AIIntentDomain[] {
  const present = new Set(tokens);
  const found: AIIntentDomain[] = [];
  for (const [domain, nouns] of DOMAIN_NOUNS) {
    if (nouns.some((noun) => present.has(noun))) found.push(domain);
  }
  return found;
}

/**
 * "quero" pede coisa nova, ou pede informação?
 *
 * Olha só para frente, e pouco: um verbo de leitura logo depois ("quero
 * saber", "quero ver") desmancha o pedido; um artigo indefinido ou o próprio
 * assunto ("quero um roteiro") o confirma.
 */
function wantsSomethingNew(tokens: readonly string[], index: number): boolean {
  const domainNouns = new Set(DOMAIN_NOUNS.flatMap(([, nouns]) => nouns));
  const end = Math.min(tokens.length, index + 1 + WANT_LOOKAHEAD);
  let confirma = false;
  for (let i = index + 1; i < end; i += 1) {
    const token = tokens[i];
    if (READ_VERBS.has(token)) return false;
    if (RESTRICTORS.has(token)) continue;
    if (INDEFINITE_ARTICLES.has(token) || domainNouns.has(token)) confirma = true;
  }
  return confirma;
}

/**
 * O que este texto pede — sem olhar histórico e sem olhar a resposta do modelo.
 *
 * Puro de propósito: a mesma função roda no servidor (antes e depois do
 * Gemini) e no cliente, e um classificador que dependesse de estado não
 * poderia ser a mesma coisa nos dois lugares.
 */
export function analyzeIntent(prompt: string): IntentAnalysis {
  const tokens = tokenizeIntent(prompt);
  const padded = ` ${tokens.join(' ')} `;

  const nearBefore = (index: number, back: number, set: ReadonlySet<string>): boolean => {
    for (let i = Math.max(0, index - back); i < index; i += 1) {
      if (set.has(tokens[i])) return true;
    }
    return false;
  };

  let explicitReadOnly = phrasePresent(padded, READ_ONLY_PHRASES);
  let explicitWrite = false;
  let readSignal = phrasePresent(padded, READ_PHRASES);

  tokens.forEach((token, index) => {
    if (READ_VERBS.has(token)) {
      readSignal = true;
      // "só me mostre", "apenas verifique", "quero só consultar".
      if (nearBefore(index, RESTRICTION_WINDOW, RESTRICTORS)) explicitReadOnly = true;
    }

    if (QUERY_WORDS.has(token) || STATE_PARTICIPLES.has(token)) readSignal = true;

    if (WRITE_VERBS.has(token)) {
      if (nearBefore(index, NEGATION_WINDOW, NEGATORS)) {
        if (BLOCKING_WRITE_VERBS.has(token)) explicitReadOnly = true;
      } else if (!nearBefore(index, DESCRIPTIVE_WINDOW, DESCRIPTIVE_MARKERS)) {
        explicitWrite = true;
      }
    }

    if (WANT_MARKERS.has(token) && wantsSomethingNew(tokens, index)) explicitWrite = true;
  });

  // Um verbo bloqueado sozinho já é proibição: "não mexa no meu roteiro".
  tokens.forEach((token, index) => {
    if (!BLOCKING_WRITE_VERBS.has(token) || WRITE_VERBS.has(token)) return;
    if (nearBefore(index, NEGATION_WINDOW, NEGATORS)) explicitReadOnly = true;
  });

  const operation: AIIntentOperation = explicitReadOnly
    ? 'read'
    : explicitWrite
      ? 'write'
      : readSignal
        ? 'read'
        : 'ambiguous';

  return {
    domains: detectDomains(tokens),
    operation,
    explicitReadOnly,
    explicitWrite,
    readSignal,
    allowsMutation: operation === 'write',
  };
}
