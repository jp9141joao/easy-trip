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
 * ## O caminho é derivado, nunca guardado
 *
 * O espelho fica em `{documentos}/easytrip/mirror/{bucket}/{storagePath}`. Como
 * `storagePath` já começa com o UID do dono (as policies de Storage exigem
 * isso), o espelho fica **namespaced por usuário de graça**: a conta B não tem
 * como chegar ao arquivo de A porque os registros de B não citam caminho nenhum
 * de A. Não há índice, não há registro paralelo para dessincronizar — o caminho
 * remoto é a identidade, e o local é uma função dele (§11).
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

function mirrorFile(bucket: string, storagePath: string): File | null {
  if (!isSafeStoragePath(storagePath)) return null;
  const segments = storagePath.split('/');
  const name = segments.pop()!;
  const dir = new Directory(Paths.document, ROOT, MIRROR, bucket, ...segments);
  return new File(dir, name);
}

function ensureDir(bucket: string, storagePath: string): void {
  const segments = storagePath.split('/');
  segments.pop();
  const dir = new Directory(Paths.document, ROOT, MIRROR, bucket, ...segments);
  if (!dir.exists) dir.create({ intermediates: true });
}

/** A URI local do arquivo, se ele já estiver no aparelho. */
export function readMirror(bucket: string, storagePath: string): string | undefined {
  try {
    const file = mirrorFile(bucket, storagePath);
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
  try {
    const target = mirrorFile(bucket, storagePath);
    if (!target) return undefined;
    ensureDir(bucket, storagePath);
    if (target.exists) target.delete();
    await new File(sourceUri).copy(target);
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
  try {
    const target = mirrorFile(bucket, storagePath);
    if (!target) return undefined;
    ensureDir(bucket, storagePath);
    if (target.exists) target.delete();
    target.create();
    target.write(new Uint8Array(bytes));
    return target.uri;
  } catch {
    return undefined;
  }
}

/**
 * Remove a cópia local. É a segunda metade de "a exclusão precisa remover as
 * duas" — e roda mesmo quando a remoção remota falha, porque um arquivo local
 * de um registro que o usuário mandou apagar não deve continuar abrindo.
 */
export function deleteMirror(bucket: string, storagePath: string): void {
  try {
    const file = mirrorFile(bucket, storagePath);
    if (file?.exists) file.delete();
  } catch {
    // Um espelho ausente é o estado desejado.
  }
}

/**
 * Apaga o espelho inteiro de um usuário.
 *
 * Usado na saída da conta e na exclusão de conta. O UID é o primeiro segmento
 * de todo caminho de Storage, então uma conta é exatamente uma pasta em cada
 * bucket — não é preciso varrer registro por registro.
 */
export function purgeMirrorForUser(userId: string): void {
  for (const bucket of ['attachments', 'journal', 'avatars']) {
    try {
      const dir = new Directory(Paths.document, ROOT, MIRROR, bucket, userId);
      if (dir.exists) dir.delete();
    } catch {
      // Segue para os outros: uma pasta que não some não pode impedir o resto.
    }
  }
}
