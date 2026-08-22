import type { Profile, UserRole } from './types';
import { USER_ROLES } from './types';

/**
 * Autorização no cliente (§3, §4, §28, §29).
 *
 * Tudo o que o aplicativo sabe sobre permissão sai daqui, a partir de um único
 * campo persistido: `profiles.role`. Não existe `isAdmin` guardado em lugar
 * nenhum, nem `adminMode`, nem `userType` — só derivações desta função.
 */

/**
 * Normaliza o que veio do banco para um papel conhecido.
 *
 * O default é sempre `user`, e isso é a regra de segurança, não um detalhe de
 * implementação: valor ausente, coluna que ainda não existe, linha de uma versão
 * antiga do schema, JSON corrompido, `undefined` porque a rede falhou — todos
 * caem em `user`. Um papel só vira `admin` quando o banco disse exatamente
 * `admin` (§28, §29).
 */
export function parseUserRole(value: unknown): UserRole {
  return USER_ROLES.includes(value as UserRole) ? (value as UserRole) : 'user';
}

/**
 * Se este perfil administra conteúdo.
 *
 * Recebe `null` de propósito: perfil ainda carregando, perfil inexistente e
 * perfil que falhou ao carregar são todos "sem privilégio". Assim a ausência de
 * informação nunca é confundida com permissão (§28, §29).
 */
export function isAdminProfile(profile: Pick<Profile, 'role'> | null | undefined): boolean {
  return profile?.role === 'admin';
}
