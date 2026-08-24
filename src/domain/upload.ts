/**
 * Regras dos arquivos que o usuário envia — anexos de bilhete, fotos do diário
 * e imagens editoriais (P-09 e P-04).
 *
 * O que está aqui **não é o controle de segurança**. O controle é o banco: a
 * `0007` põe `file_size_limit` e `allowed_mime_types` no próprio bucket, e as
 * policies de Storage prendem a escrita ao prefixo do dono. Esta camada existe
 * para o usuário receber "esse arquivo é grande demais" antes de gastar dois
 * minutos de upload, e para o caminho no Storage nunca ser montado com texto
 * que veio do seletor de arquivos.
 *
 * Por que não reaproveitar `domain/avatar.ts`: aquele módulo é a política de
 * **uma** foto de perfil e foi fechado na F5 com sua própria bateria de testes.
 * Um bilhete aceita PDF, uma foto de diário não, e uma imagem editorial vai
 * para um bucket público — três políticas diferentes que só coincidem no
 * mecanismo. O mecanismo mora aqui; a política de avatar continua onde estava.
 */

/* ------------------------------- política -------------------------------- */

export interface UploadPolicy {
  /** Tipos aceitos. Precisa ser igual ao `allowed_mime_types` do bucket. */
  readonly mimeTypes: readonly string[];
  /** Teto em bytes. Precisa ser igual ao `file_size_limit` do bucket. */
  readonly maxBytes: number;
  /** Mensagem mostrada quando o tipo não serve — específica de cada tela. */
  readonly mimeMessage: string;
}

/**
 * Extensões aceitas por tipo, com as grafias alternativas.
 *
 * Serve para dois fins: recusar o `.mov` renomeado para `.jpg` (que subiria com
 * `contentType` de imagem e nunca renderizaria) e escolher o sufixo do arquivo
 * no Storage quando o nome de origem não tiver um.
 */
const EXTENSIONS: Record<string, readonly string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'application/pdf': ['pdf'],
};

const DEFAULT_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

const MB = 1024 * 1024;

/**
 * Anexos de bilhete e apólice: PDF e imagem, 10 MB.
 *
 * O PDF entra porque é o formato em que companhia aérea e seguradora mandam o
 * documento — sem ele o recurso não serve para o caso principal. O teto é maior
 * que o do avatar porque um cartão de embarque digitalizado passa fácil dos
 * 2 MB, e menor que o disparate porque nada aqui é vídeo.
 *
 * A lista acompanha `type: ['application/pdf', 'image/*']` do `DocumentPicker`
 * em `app/trip/[tripId]/reservations.tsx`. O filtro do seletor é uma sugestão ao
 * sistema operacional, não uma garantia: no Android o usuário costuma
 * conseguir escolher "todos os arquivos". Por isso a conferência é aqui.
 */
export const ATTACHMENT_POLICY: UploadPolicy = {
  mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  maxBytes: 10 * MB,
  mimeMessage: 'Anexe um PDF ou uma imagem JPG, PNG ou WEBP.',
};

/**
 * Fotos do diário: só imagem, 10 MB.
 *
 * PDF fica de fora de propósito. A tela renderiza cada mídia com `expo-image`
 * numa galeria; um PDF apareceria como um quadro quebrado. O seletor já pede
 * `mediaTypes: ['images']` e a política aqui diz a mesma coisa.
 */
export const JOURNAL_POLICY: UploadPolicy = {
  mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  maxBytes: 10 * MB,
  mimeMessage: 'O diário aceita fotos JPG, PNG ou WEBP.',
};

/**
 * Imagens editoriais (P-04): só imagem, 5 MB.
 *
 * Vão para o bucket `content`, que é o único público do projeto — são capas de
 * artigo, foto de lugar e imagem de oferta, feitas para aparecer sem sessão.
 * Só a administração escreve nele.
 */
export const CONTENT_IMAGE_POLICY: UploadPolicy = {
  mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  maxBytes: 5 * MB,
  mimeMessage: 'Escolha uma imagem JPG, PNG ou WEBP.',
};

/* ------------------------------- validação ------------------------------- */

export interface UploadCandidate {
  name: string;
  mimeType: string;
  /** Ausente em alguns aparelhos — o seletor nem sempre informa. */
  size?: number;
}

export type UploadRejection =
  | { ok: false; reason: 'mime'; message: string }
  | { ok: false; reason: 'extension'; message: string }
  | { ok: false; reason: 'size'; message: string };

export type UploadValidation =
  | { ok: true; mimeType: string; extension: string }
  | UploadRejection;

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

export function validateUpload(candidate: UploadCandidate, policy: UploadPolicy): UploadValidation {
  // `image/jpeg; charset=binary` acontece: alguns provedores devolvem
  // parâmetros junto do tipo, e a comparação crua falharia neles.
  const mimeType = candidate.mimeType.toLowerCase().split(';')[0].trim();

  if (!policy.mimeTypes.includes(mimeType)) {
    return { ok: false, reason: 'mime', message: policy.mimeMessage };
  }

  const extension = extensionOf(candidate.name);
  if (extension && !EXTENSIONS[mimeType].includes(extension)) {
    return {
      ok: false,
      reason: 'extension',
      message: 'O nome do arquivo não combina com o conteúdo. Tente outro.',
    };
  }

  if (candidate.size !== undefined && candidate.size > policy.maxBytes) {
    return {
      ok: false,
      reason: 'size',
      message: `O arquivo precisa ter no máximo ${Math.round(policy.maxBytes / MB)} MB.`,
    };
  }

  return { ok: true, mimeType, extension: extension || DEFAULT_EXTENSION[mimeType] };
}

/* -------------------------------- caminhos ------------------------------- */

/**
 * Os caminhos abaixo são **construídos**, nunca recebidos.
 *
 * O primeiro segmento é o dono, porque é ele que a policy de Storage compara
 * com `auth.uid()`. Nada que venha do seletor de arquivos entra no caminho: o
 * nome de um arquivo pode conter `/`, `..` ou percent-encoding, e o que se
 * ganharia em legibilidade não paga o risco de um caminho apontar para outro
 * lugar. O nome de origem não é exibido em tela nenhuma — o que a tela mostra é
 * o título do bilhete e a miniatura.
 *
 * O sufixo aleatório existe para o arquivo novo nunca cair sobre o antigo:
 * `upsert: true` sobrescreveria o objeto, e a URL assinada anterior continuaria
 * servindo o conteúdo trocado até expirar.
 */
export function attachmentStoragePath(
  userId: string,
  tripId: string,
  extension: string,
  unique: string,
): string {
  return `${userId}/${tripId}/${unique}.${extension}`;
}

export function journalStoragePath(
  userId: string,
  entryId: string,
  extension: string,
  unique: string,
): string {
  return `${userId}/${entryId}/${unique}.${extension}`;
}

/**
 * As famílias de imagem editorial que o bucket `content` guarda.
 *
 * `advisors` entrou na F9, quando o cadastro de especialista ganhou painel: a
 * foto do especialista é conteúdo editorial da plataforma, não a foto de perfil
 * de uma conta. Por isso vai para `content` e não para `avatars` — aquele
 * bucket é privado, namespaced por `auth.uid()`, e um especialista não é um
 * usuário do aplicativo.
 */
export type ContentImageKind = 'places' | 'articles' | 'offers' | 'advisors';

/**
 * `content` não é namespaced por usuário: quem escreve é a administração, e a
 * policy confere `is_admin()` em vez do prefixo. O prefixo aqui organiza por
 * entidade, para uma limpeza futura conseguir varrer por tipo.
 */
export function contentImagePath(
  kind: ContentImageKind,
  entityId: string,
  extension: string,
  unique: string,
): string {
  return `${kind}/${entityId}/${unique}.${extension}`;
}

/* ------------------------- imagem gerenciada x legada --------------------- */

/**
 * O único bucket público do projeto. Repetido aqui, e não importado do
 * adaptador remoto, porque quem reconhece um caminho é o domínio: a fonte
 * local também guarda imagem editorial e também precisa da mesma resposta.
 */
export const CONTENT_BUCKET = 'content';

/** Como o Storage do Supabase expõe um objeto de bucket público. */
const PUBLIC_OBJECT_PREFIX = `/storage/v1/object/public/${CONTENT_BUCKET}/`;

/** Onde `persistFile(['content', …])` grava no aparelho (modo local/demo). */
const LOCAL_CONTENT_PREFIX = `/${CONTENT_BUCKET}/`;

/**
 * De onde veio a imagem que está gravada no registro.
 *
 * `managed`  — arquivo que o próprio Easy Trip enviou e sabe apagar;
 * `external` — URL de terceiro (o Unsplash do P-04, o site do parceiro);
 * `none`     — o registro não tem imagem.
 *
 * A distinção não é cosmética: é ela que impede um `storage.remove()` de ser
 * chamado com `https://images.unsplash.com/...` quando o administrador troca a
 * capa de um conteúdo antigo (§17 da F9). Apagar não é possível ali, mas pedir
 * a remoção de um caminho que na verdade é uma URL inteira já foi a origem de
 * defeito parecido em outros projetos — e o efeito seria mascarar o erro.
 */
export type EditorialImageOrigin = 'managed' | 'external' | 'none';

function withoutQuery(value: string): string {
  return value.split('#')[0].split('?')[0];
}

/**
 * Devolve o caminho dentro do bucket `content`, ou `undefined` se o valor não
 * for um arquivo gerenciado.
 *
 * Cobre as duas formas em que uma imagem gerenciada aparece:
 *
 *   Supabase → `https://<projeto>/storage/v1/object/public/content/<path>`
 *   local    → `file:///…/easytrip/content/<path>`
 *
 * O reconhecimento é por estrutura, não por host: um projeto tem uma URL em
 * desenvolvimento e outra em produção, e comparar com a configuração atual
 * faria o mesmo registro ser "gerenciado" num ambiente e "externo" no outro.
 */
export function managedContentPath(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const clean = withoutQuery(value.trim());

  const publicIndex = clean.indexOf(PUBLIC_OBJECT_PREFIX);
  if (publicIndex !== -1) {
    const path = clean.slice(publicIndex + PUBLIC_OBJECT_PREFIX.length);
    return path.length > 0 ? path : undefined;
  }

  if (clean.startsWith('file:')) {
    const localIndex = clean.indexOf(LOCAL_CONTENT_PREFIX);
    if (localIndex === -1) return undefined;
    const path = clean.slice(localIndex + LOCAL_CONTENT_PREFIX.length);
    return path.length > 0 ? path : undefined;
  }

  return undefined;
}

export function editorialImageOrigin(value: string | null | undefined): EditorialImageOrigin {
  if (!value || !value.trim()) return 'none';
  return managedContentPath(value) ? 'managed' : 'external';
}

/**
 * O caminho pertence mesmo a este registro?
 *
 * `content/{kind}/{entityId}/{uuid}.{ext}` é montado por
 * `contentImagePath`, então o próprio caminho prova de quem é o arquivo. Sem
 * esta conferência, um valor colado à mão na coluna transformaria "trocar a
 * imagem deste artigo" em "apagar a imagem de outro conteúdo" — o mesmo
 * raciocínio de `ownsPath` no ciclo de vida dos arquivos privados, com a
 * entidade no lugar do usuário.
 */
export function managedPathBelongsTo(
  path: string,
  kind: ContentImageKind,
  entityId: string,
): boolean {
  const segments = path.split('/');
  return segments.length >= 3 && segments[0] === kind && segments[1] === entityId;
}
