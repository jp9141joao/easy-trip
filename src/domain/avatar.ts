/**
 * Regras do avatar (§7, §8).
 *
 * Função pura, sem rede e sem Storage: é a camada que recusa o arquivo antes de
 * ele sair do aparelho, para o usuário receber "essa imagem é muito grande" em
 * vez de um erro de upload dez segundos depois.
 *
 * Não é o controle de segurança. Esse é o banco: a `0006` põe `file_size_limit`
 * e `allowed_mime_types` no próprio bucket, e as policies de Storage prendem a
 * escrita a `{auth.uid()}/`. O que está aqui é a primeira barreira, a que dá
 * uma resposta útil.
 */

/**
 * Os três formatos que o `expo-image` renderiza em Android e iOS. HEIC fica de
 * fora de propósito: o iPhone entrega HEIC por padrão, mas o Android não o
 * exibe — aceitá-lo produziria avatares invisíveis para metade dos usuários.
 * O `ImagePicker` converte para JPEG quando `allowsEditing` está ligado.
 */
export const AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AvatarMimeType = (typeof AVATAR_MIME_TYPES)[number];

/**
 * 5 MB. Uma foto de perfil é exibida com 92 pontos de lado; o limite existe
 * para barrar o disparate (um PNG de câmera profissional), não para apertar o
 * caso normal, que sai do picker com `quality: 0.8` em algumas centenas de kB.
 */
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

const EXTENSION_BY_MIME: Record<AvatarMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Extensões aceitas por tipo, incluindo as grafias alternativas. */
const ACCEPTED_EXTENSIONS: Record<AvatarMimeType, string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
};

export interface AvatarCandidate {
  name: string;
  mimeType: string;
  /** Ausente em alguns aparelhos — o picker nem sempre informa. */
  size?: number;
}

export type AvatarRejection =
  | { ok: false; reason: 'mime'; message: string }
  | { ok: false; reason: 'extension'; message: string }
  | { ok: false; reason: 'size'; message: string };

export type AvatarValidation = { ok: true; mimeType: AvatarMimeType; extension: string } | AvatarRejection;

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

export function validateAvatar(candidate: AvatarCandidate): AvatarValidation {
  const mimeType = candidate.mimeType.toLowerCase().split(';')[0].trim();

  if (!AVATAR_MIME_TYPES.includes(mimeType as AvatarMimeType)) {
    return {
      ok: false,
      reason: 'mime',
      message: 'Escolha uma imagem JPG, PNG ou WEBP.',
    };
  }
  const allowed = mimeType as AvatarMimeType;

  // Nome e tipo precisam concordar. Os dois vêm do picker, então isto não é
  // defesa contra um atacante — é defesa contra um `.mov` renomeado para
  // `.jpg` na galeria, que subiria com `contentType` de imagem e nunca
  // renderizaria.
  const extension = extensionOf(candidate.name);
  if (extension && !ACCEPTED_EXTENSIONS[allowed].includes(extension)) {
    return {
      ok: false,
      reason: 'extension',
      message: 'O arquivo não parece ser uma imagem válida. Tente outra foto.',
    };
  }

  if (candidate.size !== undefined && candidate.size > AVATAR_MAX_BYTES) {
    const mb = (AVATAR_MAX_BYTES / 1024 / 1024).toFixed(0);
    return {
      ok: false,
      reason: 'size',
      message: `A imagem precisa ter no máximo ${mb} MB.`,
    };
  }

  // Sem extensão no nome, a do tipo declarado vale — o caminho no Storage
  // precisa de uma, e inventá-la a partir do MIME é melhor que gravar um
  // arquivo sem sufixo nenhum.
  return { ok: true, mimeType: allowed, extension: extension || EXTENSION_BY_MIME[allowed] };
}

/**
 * Caminho do avatar dentro do bucket.
 *
 * O primeiro segmento é sempre o UID, porque é ele que a policy de Storage
 * compara com `auth.uid()`. O nome vindo do picker **não** entra: ele pode
 * conter `../`, barras ou caracteres que mudariam o prefixo — e é o prefixo que
 * decide de quem é a pasta.
 *
 * O sufixo aleatório existe para o arquivo novo nunca cair sobre o antigo. Com
 * caminho fixo o upload seria mais simples, mas a URL assinada anterior
 * continuaria apontando para o mesmo objeto, e a foto trocada poderia continuar
 * aparecendo até o cache expirar.
 */
export function avatarStoragePath(userId: string, extension: string, unique: string): string {
  return `${userId}/avatar-${unique}.${extension}`;
}
