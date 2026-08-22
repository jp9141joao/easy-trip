/**
 * Escolha de imagem editorial pelo painel (F9, §8 e §13 — P-04).
 *
 * A tela não conversa com o `expo-image-picker` diretamente por um motivo
 * prático: o que decide se o arquivo serve é a política do bucket, e essa
 * decisão precisa ser testável sem aparelho. Aqui a permissão, o cancelamento,
 * a recusa por tipo/tamanho e o arquivo aceito viram quatro resultados
 * nomeados — a tela só escolhe o que dizer em cada um.
 *
 * O que este módulo **não** faz: enviar. Abrir o seletor não é publicar. O
 * arquivo escolhido fica em memória até o administrador tocar em "Salvar", e o
 * upload só acontece lá (§8). Quem abre o formulário, escolhe uma foto e
 * desiste não deixa nada no Storage.
 */

import * as ImagePicker from 'expo-image-picker';

import { CONTENT_IMAGE_POLICY, validateUpload } from '@/domain/upload';
import type { UploadableFile } from '@/repositories/types';
import { guessMimeType } from './files';

export type PickedImage =
  | { status: 'picked'; file: UploadableFile }
  | { status: 'cancelled' }
  | { status: 'denied' }
  | { status: 'rejected'; message: string };

/**
 * Abre a galeria, valida contra `CONTENT_IMAGE_POLICY` e devolve o arquivo.
 *
 * A validação aqui é conveniência, não segurança: o bucket `content` tem
 * `allowed_mime_types` e `file_size_limit` desde a `0007`, e é ele quem recusa
 * de verdade. A diferença é que a recusa do bucket chega depois de o arquivo
 * inteiro subir, e sem motivo legível. Esta recusa chega antes e explica.
 */
export async function pickEditorialImage(): Promise<PickedImage> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return { status: 'denied' };

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    // Sem `allowsEditing`: a proporção de uma capa de artigo não é a de um
    // avatar, e o recorte quadrado do seletor cortaria a foto no lugar errado.
    quality: 0.85,
  });
  if (result.canceled || !result.assets?.[0]) return { status: 'cancelled' };

  const asset = result.assets[0];
  const name = asset.fileName ?? `imagem-${Date.now()}.jpg`;
  const file: UploadableFile = {
    uri: asset.uri,
    name,
    mimeType: asset.mimeType ?? guessMimeType(name, 'image/jpeg'),
    size: asset.fileSize,
  };

  const validation = validateUpload(file, CONTENT_IMAGE_POLICY);
  if (!validation.ok) return { status: 'rejected', message: validation.message };

  // O tipo normalizado é o que vai no `Content-Type` do upload: `image/jpeg`,
  // não `image/jpeg; charset=binary`.
  return { status: 'picked', file: { ...file, mimeType: validation.mimeType } };
}
