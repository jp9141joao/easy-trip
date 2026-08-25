/**
 * Cópia local dos arquivos privados — o requisito da decisão D-04.
 *
 * A decisão, em `SUPABASE_IMPLEMENTATION_PLAN.md` §32, é literal:
 *
 *   "o Supabase Storage é a *origem oficial* do arquivo, nunca a *única forma
 *    de acesso*. Uma cópia local é gravada ao anexar e ao baixar; a leitura
 *    prefere a cópia local e só recorre à URL assinada quando não houver uma.
 *    A exclusão precisa remover as duas."
 *
 * O motivo é concreto: com o Storage, `fileUrl` passa a ser URL assinada com
 * validade de uma hora. Sozinha, ela é uma **regressão** — o cartão de embarque
 * abria sem rede quando o arquivo era local, e deixaria de abrir justamente no
 * aeroporto, que é onde ele importa.
 *
 * ## O dono da cópia local é quem BAIXOU, não quem criou o objeto remoto
 *
 * O espelho ficava em `{documentos}/easytrip/mirror/{bucket}/{storagePath}`, e
 * o argumento era que `storagePath` já começa com o UID de quem enviou — logo o
 * espelho estaria "namespaced de graça". Isso valia enquanto arquivo era sempre
 * do próprio usuário. Com viagem compartilhada deixou de valer:
 *
 *   A anexa o bilhete   → objeto remoto `A/viagem/bilhete.pdf`
 *   B abre o bilhete    → cópia local em `mirror/attachments/A/viagem/…`
 *
 * A cópia é de B — está no aparelho porque B a baixou — mas mora debaixo do UID
 * de A. Sair da conta de B não a removia (o expurgo procurava a pasta de B), e
 * sair da conta de A removia um arquivo que era de B.
 *
 * Agora o namespace é o **espectador**:
 *
 *   {documentos}/easytrip/mirror/accounts/{viewerId}/{bucket}/{storagePath}
 *
 * Cada conta tem a sua própria cópia do mesmo objeto remoto, e a saída de uma
 * não alcança a da outra. Continua não havendo índice paralelo: o caminho segue
 * sendo função de (espectador, bucket, caminho remoto).
 *
 * ## Quem é o espectador
 *
 * `setMirrorViewer` é chamado pelo `AuthProvider` a cada sessão aplicada, e com
 * `null` na saída. Sem espectador não se lê nem se grava espelho: uma cópia
 * local sem dono é exatamente o defeito que este módulo existe para não ter.
 *
 * ## Download que termina depois da saída
 *
 * Toda gravação guarda o par (espectador, época) do começo e o confere de novo
 * antes de escrever. Um download disparado por B que só termina depois do
 * logout de B não recria a cópia: a época avançou, e a escrita é descartada.
 *
 * ## O que NÃO entra aqui
 *
 * URL assinada nenhuma. Ela é derivada e expira; guardá-la como identidade foi
 * exatamente o defeito que a F5 encontrou no avatar. O que se guarda é o
 * `storagePath`; a URL se gera de novo a cada leitura, quando necessária.
 */

import { Directory, File, Paths } from 'expo-file-system';

const ROOT = 'easytrip';
const MIRROR = 'mirror';
/** Segmento que separa o espelho por conta espectadora. */
const ACCOUNTS = 'accounts';

const BUCKETS = ['attachments', 'journal', 'avatars'] as const;

/**
 * Quem está olhando agora, e há quantas trocas de sessão.
 *
 * A época avança a cada chamada — inclusive quando o mesmo usuário volta. Uma
 * gravação atrasada pertence à sessão em que começou, não à conta que por acaso
 * tem o mesmo id depois.
 */
let activeViewer: string | null = null;
let viewerEpoch = 0;

export function setMirrorViewer(userId: string | null): void {
  // Renovação de token reaplica a MESMA sessão de hora em hora. Avançar a época
  // aí dentro cancelaria o espelhamento de um download longo sem que nada
  // tivesse mudado — a época marca troca de identidade, não de credencial.
  if (activeViewer === userId) return;
  activeViewer = userId;
  viewerEpoch += 1;
}

export function getMirrorViewer(): string | null {
  return activeViewer;
}

interface MirrorSession {
  viewer: string;
  epoch: number;
}

function currentSession(): MirrorSession | null {
  return activeViewer ? { viewer: activeViewer, epoch: viewerEpoch } : null;
}

/** A sessão que começou a gravação ainda é a sessão em curso? */
function stillCurrent(session: MirrorSession): boolean {
  return activeViewer === session.viewer && viewerEpoch === session.epoch;
}

/**
 * O caminho remoto é confiável o bastante para virar caminho local?
 *
 * O valor vem de uma coluna do banco, e uma linha adulterada não pode fazer o
 * aplicativo escrever fora da própria pasta. `..` e caminho absoluto são
 * recusados; o resto é estrutura normal de chave do Storage.
 */
function isSafeStoragePath(storagePath: string): boolean {
  if (!storagePath || storagePath.startsWith('/')) return false;
  if (storagePath.includes('\\')) return false;
  const segments = storagePath.split('/');
  return segments.length >= 2 && segments.every((s) => s.length > 0 && s !== '.' && s !== '..');
}

/** O UID do espectador vira segmento de caminho: vale a mesma desconfiança. */
function isSafeViewerId(viewerId: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(viewerId);
}

function accountRoot(viewerId: string): Directory {
  return new Directory(Paths.document, ROOT, MIRROR, ACCOUNTS, viewerId);
}

function mirrorFile(viewerId: string, bucket: string, storagePath: string): File | null {
  if (!isSafeViewerId(viewerId) || !isSafeStoragePath(storagePath)) return null;
  const segments = storagePath.split('/');
  const name = segments.pop()!;
  const dir = new Directory(Paths.document, ROOT, MIRROR, ACCOUNTS, viewerId, bucket, ...segments);
  return new File(dir, name);
}

function ensureDir(viewerId: string, bucket: string, storagePath: string): void {
  const segments = storagePath.split('/');
  segments.pop();
  const dir = new Directory(Paths.document, ROOT, MIRROR, ACCOUNTS, viewerId, bucket, ...segments);
  if (!dir.exists) dir.create({ intermediates: true });
}

/** A URI local do arquivo, se a conta que está olhando já o tiver no aparelho. */
export function readMirror(bucket: string, storagePath: string): string | undefined {
  try {
    const viewer = activeViewer;
    if (!viewer) return undefined;
    const file = mirrorFile(viewer, bucket, storagePath);
    if (!file) return undefined;
    return file.exists ? file.uri : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Guarda uma cópia local a partir de um arquivo que já está no aparelho.
 *
 * É o caminho do "ao anexar": o usuário acabou de escolher o arquivo, ele já
 * está no disco, e copiá-lo custa nada perto de baixá-lo de volta depois.
 *
 * Falha de espelhamento **não** é falha da operação. Se o disco estiver cheio,
 * o anexo continua tendo sido enviado e continua abrindo com rede — o que se
 * perde é a comodidade offline, não o dado.
 */
export async function writeMirrorFromFile(
  bucket: string,
  storagePath: string,
  sourceUri: string,
): Promise<string | undefined> {
  const session = currentSession();
  if (!session) return undefined;
  try {
    const target = mirrorFile(session.viewer, bucket, storagePath);
    if (!target) return undefined;
    ensureDir(session.viewer, bucket, storagePath);
    if (target.exists) target.delete();
    await new File(sourceUri).copy(target);
    // A cópia pode ter demorado. Se a sessão virou no meio, o arquivo recém
    // escrito não é de ninguém que ainda esteja aqui.
    if (!stillCurrent(session)) {
      if (target.exists) target.delete();
      return undefined;
    }
    return target.uri;
  } catch {
    return undefined;
  }
}

/**
 * Guarda uma cópia local a partir dos bytes baixados.
 *
 * É o caminho do "ao baixar": o arquivo veio de outro aparelho, então a
 * primeira abertura com rede é a chance de deixá-lo disponível para a próxima
 * sem rede.
 */
export async function writeMirrorFromBytes(
  bucket: string,
  storagePath: string,
  bytes: ArrayBuffer,
): Promise<string | undefined> {
  const session = currentSession();
  if (!session) return undefined;
  // O download que produziu estes bytes começou antes; a sessão pode ter
  // acabado enquanto ele corria. Escrever agora recriaria no aparelho um
  // arquivo da conta que acabou de sair (§13 do handoff).
  if (!stillCurrent(session)) return undefined;
  try {
    const target = mirrorFile(session.viewer, bucket, storagePath);
    if (!target) return undefined;
    ensureDir(session.viewer, bucket, storagePath);
    if (target.exists) target.delete();
    target.create();
    target.write(new Uint8Array(bytes));
    if (!stillCurrent(session)) {
      if (target.exists) target.delete();
      return undefined;
    }
    return target.uri;
  } catch {
    return undefined;
  }
}

/**
 * Remove a cópia local **desta conta**. É a segunda metade de "a exclusão
 * precisa remover as duas" — e roda mesmo quando a remoção remota falha, porque
 * um arquivo local de um registro que o usuário mandou apagar não deve
 * continuar abrindo.
 *
 * Não alcança a cópia de outro membro: cada conta é dona da sua.
 */
export function deleteMirror(bucket: string, storagePath: string): void {
  const viewer = activeViewer;
  if (!viewer) return;
  deleteMirrorFor(viewer, bucket, storagePath);
}

/** Idem, para uma conta nomeada — usado pelas limpezas que não são a atual. */
export function deleteMirrorFor(viewerId: string, bucket: string, storagePath: string): void {
  try {
    const file = mirrorFile(viewerId, bucket, storagePath);
    if (file?.exists) file.delete();
  } catch {
    // Um espelho ausente é o estado desejado.
  }
}

/**
 * Apaga o espelho inteiro de uma conta.
 *
 * Usado na saída da conta e na exclusão de conta. Agora é uma pasta só — a da
 * conta — em vez de uma pasta por bucket dentro do UID de quem enviou. A cópia
 * que outra conta baixou do mesmo objeto remoto continua onde está.
 *
 * O layout antigo (`mirror/{bucket}/{uid}/…`) também é removido: quem atualizar
 * o aplicativo no meio de uma viagem tem arquivos lá, e eles precisam sair
 * junto com a conta.
 */
export function purgeMirrorForUser(userId: string): void {
  if (!isSafeViewerId(userId)) return;
  try {
    const dir = accountRoot(userId);
    if (dir.exists) dir.delete();
  } catch {
    // Segue para o layout antigo: uma pasta que não some não pode impedir o resto.
  }

  for (const bucket of BUCKETS) {
    try {
      const legado = new Directory(Paths.document, ROOT, MIRROR, bucket, userId);
      if (legado.exists) legado.delete();
    } catch {
      // Idem.
    }
  }
}

/**
 * Apaga as cópias locais de uma viagem à qual esta conta perdeu acesso (§59).
 *
 * O conteúdo remoto continua com o grupo; some apenas a cópia de quem saiu ou
 * foi removido. Dois caminhos, porque as chaves do Storage têm formatos
 * diferentes:
 *
 *  - anexos/reservas são `{uid}/{tripId}/{arquivo}` — dá para varrer a árvore
 *    da conta e apagar a pasta cujo segundo segmento é a viagem;
 *  - mídia de diário é `{uid}/{entryId}/{arquivo}` — a viagem não aparece no
 *    caminho, então quem chama passa os caminhos que conhece pelo cache.
 */
export function purgeTripMirrors(
  viewerId: string,
  tripId: string,
  extraPaths: readonly { bucket: string; storagePath: string }[] = [],
): void {
  if (!isSafeViewerId(viewerId) || !isSafeViewerId(tripId)) return;

  for (const bucket of BUCKETS) {
    try {
      const bucketDir = new Directory(Paths.document, ROOT, MIRROR, ACCOUNTS, viewerId, bucket);
      if (!bucketDir.exists) continue;
      for (const ownerDir of listDirectories(bucketDir)) {
        const tripDir = new Directory(ownerDir, tripId);
        if (tripDir.exists) tripDir.delete();
      }
    } catch {
      // Uma varredura que falha não pode impedir os caminhos explícitos abaixo.
    }
  }

  for (const { bucket, storagePath } of extraPaths) {
    deleteMirrorFor(viewerId, bucket, storagePath);
  }
}

/**
 * As subpastas de um diretório, tolerando um `list()` ausente.
 *
 * `Directory.list()` existe na API nova do `expo-file-system`, mas este módulo
 * não pode quebrar se rodar sobre uma versão que não a exponha: o expurgo por
 * caminho explícito continua valendo.
 */
function listDirectories(dir: Directory): Directory[] {
  const list = (dir as unknown as { list?: () => unknown[] }).list;
  if (typeof list !== 'function') return [];
  const entries = list.call(dir) ?? [];
  return entries.filter((entry): entry is Directory => entry instanceof Directory);
}
