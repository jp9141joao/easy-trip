/**
 * Colaboração: papéis, permissões e o vocabulário que a interface usa.
 *
 * Este arquivo é a tradução do que a RLS já decide no servidor (0008). A
 * duplicação é deliberada e tem um limite claro: aqui ela serve para a tela
 * **não oferecer** o que seria recusado — um botão que existe só para dar erro
 * é um defeito de interface. Ela NÃO é a autorização. Se alguém apagar este
 * arquivo inteiro, nada fica inseguro: fica feio.
 *
 * A regra prática para saber onde algo pertence: se a resposta errada causa um
 * vazamento, mora no Postgres; se causa um botão inútil, mora aqui.
 */

export const TRIP_ROLES = ['owner', 'editor', 'viewer'] as const;
export type TripRole = (typeof TRIP_ROLES)[number];

/** Papéis que um convite pode oferecer. `owner` não se convida — se transfere. */
export const INVITABLE_ROLES = ['editor', 'viewer'] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export type InviteStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';

export interface TripMember {
  id: string;
  tripId: string;
  userId: string;
  role: TripRole;
  /** Nome do perfil, quando legível. Ver `memberDisplayName`. */
  name?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TripInvite {
  id: string;
  tripId: string;
  invitedUserId: string;
  invitedBy: string;
  role: InvitableRole;
  status: InviteStatus;
  /** Nome de quem foi convidado, quando o perfil é legível. */
  invitedName?: string;
  createdAt: string;
  respondedAt?: string;
}

/* ------------------------------- permissões ------------------------------- */

export function isTripOwner(role: TripRole | undefined): boolean {
  return role === 'owner';
}

/** Pode criar, editar e apagar conteúdo compartilhado da viagem. */
export function canEditTrip(role: TripRole | undefined): boolean {
  return role === 'owner' || role === 'editor';
}

/** Convidar, remover, mudar permissão: só o proprietário. */
export function canManageMembers(role: TripRole | undefined): boolean {
  return role === 'owner';
}

/** Destino, datas, orçamento e exclusão da viagem: também só o proprietário. */
export function canEditTripSettings(role: TripRole | undefined): boolean {
  return role === 'owner';
}

/**
 * Sair da viagem. O proprietário não sai enquanto houver mais alguém dentro
 * (§50): sair deixaria a viagem sem quem gerencie e o conteúdo compartilhado
 * dos outros sem dono. Transferência de propriedade não existe nesta fase, e
 * improvisar uma seria pior do que não ter.
 */
export function canLeaveTrip(role: TripRole | undefined, memberCount: number): boolean {
  if (!role) return false;
  if (role !== 'owner') return true;
  return memberCount <= 1;
}

/* -------------------------------- rótulos --------------------------------- */

export const ROLE_LABEL: Record<TripRole, string> = {
  owner: 'Proprietário',
  editor: 'Pode editar',
  viewer: 'Somente visualizar',
};

/**
 * O que o leitor de tela ouve. Não é o mesmo texto da etiqueta: "Pode editar"
 * sozinho não diz de quem se está falando nem de que viagem (§70).
 */
export function roleAccessibilityLabel(name: string, role: TripRole): string {
  return `${name}. ${ROLE_LABEL[role]}.`;
}

/**
 * Como um membro aparece na tela.
 *
 * `profiles` só é legível pelo próprio dono (policy `profiles_select`, 0002), e
 * essa policy não é afrouxada por causa de uma lista de viajantes: o perfil
 * guarda telefone, cidade e estilo de viagem, e nada disso pertence a quem
 * divide um roteiro. O que o servidor devolve para os outros membros é o nome,
 * por uma consulta que só seleciona o nome (§52).
 *
 * Quando nem isso existe — conta excluída, ou um ex-membro cujo conteúdo
 * compartilhado ficou na viagem —, "Viajante" é a resposta honesta. Inventar
 * um nome a partir do e-mail seria expor o e-mail.
 */
export function memberDisplayName(member: { name?: string; userId: string }, selfId?: string): string {
  if (member.userId === selfId) return 'Você';
  return member.name?.trim() || 'Viajante';
}

/** "Adicionado por Maria" — vazio quando o autor é quem está lendo (§9). */
export function authorshipLabel(
  createdBy: string | undefined,
  selfId: string | undefined,
  names: Record<string, string>,
): string | undefined {
  if (!createdBy || createdBy === selfId) return undefined;
  const name = names[createdBy]?.trim();
  return name ? `Adicionado por ${name}` : undefined;
}
