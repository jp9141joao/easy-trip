/**
 * Local file persistence (§42, CA-04).
 *
 * A picked document/photo lives in a temporary cache directory that the OS is
 * free to purge. To make "anexar arquivo" actually mean something, we copy it
 * into the app's document directory, and the stored URL keeps working after the
 * app is closed and reopened.
 */

import { Directory, File, Paths } from 'expo-file-system';

import type { StoredFile, UploadableFile } from '@/repositories/types';

const ROOT = 'easytrip';

function sanitizeName(name: string): string {
  return name.replace(/[^\w.\-]+/g, '_').slice(-80) || 'arquivo';
}

function folderFor(segments: string[]): Directory {
  const dir = new Directory(Paths.document, ROOT, ...segments);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/** Copies a picked file into permanent app storage and returns its URI. */
export async function persistFile(
  segments: string[],
  file: UploadableFile,
): Promise<StoredFile> {
  const dir = folderFor(segments);
  const destination = new File(dir, `${Date.now()}-${sanitizeName(file.name)}`);
  const source = new File(file.uri);
  await source.copy(destination);
  return { url: destination.uri, mimeType: file.mimeType };
}

/** Best-effort removal — a missing file is not an error worth surfacing. */
export function deleteStoredFile(uri: string): void {
  try {
    if (!uri.startsWith('file:')) return;
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Ignore: the record is going away regardless.
  }
}

/** True when a stored attachment is still readable on this device. */
export function storedFileExists(uri: string): boolean {
  try {
    if (!uri.startsWith('file:')) return true; // remote URL — assume reachable
    return new File(uri).exists;
  } catch {
    return false;
  }
}

/**
 * Apaga uma pasta que este aplicativo escreveu.
 *
 * Substitui o antigo `purgeAllFiles`, que removia a raiz `easytrip` inteira. No
 * modo local o arquivo **é** o dado — não há cópia remota — e a raiz guarda os
 * arquivos de TODAS as contas do aparelho, mais as imagens editoriais. Apagá-la
 * na saída de uma conta destruía o diário de outra, e apagava arquivos cujos
 * registros continuavam no banco local, deixando cada anexo quebrado.
 */
export function deleteStoredFolder(segments: string[]): void {
  try {
    const dir = new Directory(Paths.document, ROOT, ...segments);
    if (dir.exists) dir.delete();
  } catch {
    // Ignore.
  }
}

export function guessMimeType(name: string, fallback = 'application/octet-stream'): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    heic: 'image/heic',
    gif: 'image/gif',
    txt: 'text/plain',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  return map[ext] ?? fallback;
}

export function isImageMime(mimeType?: string): boolean {
  return Boolean(mimeType?.startsWith('image/'));
}

export function isPdfMime(mimeType?: string): boolean {
  return mimeType === 'application/pdf';
}
