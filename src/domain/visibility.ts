/**
 * Visibilidade de um item dentro de uma viagem compartilhada.
 *
 * Duas posições, e nenhuma terceira: ou todos os membros veem, ou só quem
 * criou. Um "visível para alguns" exigiria uma lista por item, e uma lista por
 * item é uma promessa que a tela não consegue manter legível — nem o usuário
 * consegue auditar.
 *
 * Quem faz valer é a RLS (0009). Aqui ficam os defaults e os rótulos.
 */

export const VISIBILITIES = ['shared', 'private'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

/**
 * Onde a visibilidade se aplica. Não é toda tabela da viagem: `goals` é do
 * usuário e não da viagem, `journal_media` herda da entrada a que pertence, e
 * `trip_suggestions` é da viagem por definição (§48).
 */
export type VisibilityScope =
  | 'itinerary'
  | 'checklist'
  | 'expense'
  | 'journal'
  | 'reservation';

/**
 * O default de CRIAÇÃO (§11).
 *
 * Não é "tudo compartilhado", e a assimetria é a parte importante: roteiro e
 * checklist são a logística que a viagem inteira precisa enxergar; despesa e
 * diário são a vida particular de quem viaja junto. Errar para o lado do
 * compartilhado nesses dois entregaria informação que ninguém decidiu entregar.
 *
 * Reserva entra como compartilhada porque quem a cria numa viagem com gente
 * dentro está registrando o voo de todos — e porque o documento anexado é o
 * mesmo que o grupo precisa no aeroporto. O que já existia antes da
 * colaboração entrou como privado; o porquê está no cabeçalho da 0009.
 */
export const DEFAULT_VISIBILITY: Record<VisibilityScope, Visibility> = {
  itinerary: 'shared',
  checklist: 'shared',
  reservation: 'shared',
  expense: 'private',
  journal: 'private',
};

export const VISIBILITY_LABEL: Record<Visibility, string> = {
  shared: 'Todos da viagem',
  private: 'Somente eu',
};

/** Etiqueta curta, para chip em lista. */
export const VISIBILITY_CHIP: Record<Visibility, string> = {
  shared: 'Compartilhado',
  private: 'Somente eu',
};

/**
 * §70: nunca depender só da cor nem só do ícone. Este é o texto que acompanha
 * o cadeado/pessoas em qualquer lugar onde o estado apareça.
 */
export function visibilityAccessibilityLabel(visibility: Visibility): string {
  return visibility === 'shared'
    ? 'Compartilhado com todos os viajantes'
    : 'Privado, somente você vê';
}

export function parseVisibility(value: unknown, fallback: Visibility = 'shared'): Visibility {
  return value === 'shared' || value === 'private' ? value : fallback;
}

/**
 * A mesma regra da policy de SELECT da 0009, para o cliente poder filtrar o que
 * já tem em cache sem perguntar ao servidor.
 *
 * Existe porque a fonte local (modo demonstração) precisa dela de verdade — lá
 * não há Postgres para aplicar a policy. No modo conectado ela é redundante, e
 * é bom que seja: se um dia divergir da policy, o que chega à tela continua
 * sendo o que o servidor deixou passar.
 */
export function isVisibleTo(
  item: { visibility: Visibility; createdBy?: string },
  userId: string | undefined,
): boolean {
  return item.visibility === 'shared' || (Boolean(userId) && item.createdBy === userId);
}
