import type { Offer } from './types';

/**
 * A vigência de uma oferta, na mesma definição dos dois lados.
 *
 * A regra nasceu em SQL, dentro da policy `offers_read` (0004):
 *
 *   status = 'published'
 *   and (active_from  is null or active_from  <= current_date)
 *   and (active_until is null or active_until >= current_date)
 *
 * O modo local precisa responder igual, e o cliente Supabase precisa repetir o
 * filtro para o administrador (para quem a RLS devolve tudo). Três lugares com
 * a mesma regra escrita três vezes é a receita para elas divergirem, então a
 * regra vive aqui e os três a chamam.
 *
 * Os dois extremos são **inclusivos**, como o `<=` e o `>=` do SQL: uma oferta
 * que começa hoje já vale hoje, e uma que termina hoje vale até o fim do dia.
 * `null` significa "sem limite deste lado".
 */
export function isOfferLive(offer: Offer, today: string): boolean {
  if (offer.status !== 'published') return false;
  if (offer.activeFrom && offer.activeFrom > today) return false;
  if (offer.activeUntil && offer.activeUntil < today) return false;
  return true;
}

/**
 * Ordem editorial: `sortOrder` crescente, empate resolvido pelo `id`.
 *
 * O desempate existe para a listagem ser estável. Sem ele, duas ofertas com o
 * mesmo `sortOrder` — o caso comum, já que o padrão da coluna é `0` — podem
 * trocar de lugar entre duas leituras, e o índice do PostgreSQL
 * (`status, sort_order, id`) já ordena assim.
 */
export function byEditorialOrder(a: Offer, b: Offer): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
