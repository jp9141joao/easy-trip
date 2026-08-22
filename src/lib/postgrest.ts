/**
 * Ajuda para montar filtros do PostgREST sem interpolar texto cru (P-08).
 *
 * Um filtro `or=(a.eq.X,b.eq.X)` é uma **árvore**, e a vírgula e os parênteses
 * são a gramática dela. Emendar o valor direto na string entrega essa gramática
 * a quem controla o valor: medido contra o PostgREST local, `X` valendo
 * `<uuid>,status.eq.draft` transforma
 *
 *   or=(id.eq.<uuid>,slug.eq.<uuid>)
 *
 * em quatro ramos, um deles `status.eq.draft` — e a consulta passa a devolver
 * rascunho. Com `service_role` o rascunho volta; com sessão comum a policy
 * `articles_read` (corrigida no P-01) devolve vazio. Ou seja: hoje o que segura
 * é a última barreira, não a primeira. É essa a que se corrige aqui.
 */

/** Uma string com a forma canônica de UUID. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/**
 * Escapa um valor para dentro de um filtro composto (`or`, `and`, `not.or`…).
 *
 * O PostgREST aceita o valor entre aspas duplas, e dentro delas trata `\` como
 * escape. Aspa e contrabarra são os dois únicos caracteres que precisam de
 * tratamento; vírgula, parêntese e ponto perdem o sentido gramatical assim que
 * estão entre aspas.
 *
 * Use isto só onde o filtro composto for mesmo necessário. Quando dá para
 * expressar a consulta com `.eq()` / `.ilike()` — que viajam como parâmetros
 * separados e não passam pelo parser de árvore — é melhor: não há nada para
 * escapar.
 */
export function quoteFilterValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Prepara um termo de busca para `ilike`, escapando também os curingas do
 * `LIKE`.
 *
 * Sem isto, digitar `%` na busca casa com tudo e digitar `_` casa com qualquer
 * caractere — não é falha de segurança, mas é resultado errado, e o usuário não
 * tem como saber por quê.
 */
export function likeContains(term: string): string {
  const escaped = term.replace(/([\\%_])/g, '\\$1');
  return quoteFilterValue(`%${escaped}%`);
}
