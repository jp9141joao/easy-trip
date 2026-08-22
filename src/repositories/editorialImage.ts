/**
 * Ordem segura entre a imagem editorial e o registro que aponta para ela
 * (F9, §15–§18 — fechamento do P-04).
 *
 * O formulário administrativo tem duas gravações para fazer e elas moram em
 * lugares diferentes: o arquivo vai para o bucket `content` e a referência vai
 * para uma coluna. Não existe transação entre os dois, então a única coisa que
 * evita lixo e registro quebrado é a **ordem** e a **compensação** — que é
 * exatamente o que este módulo centraliza, para não ser reescrito quatro vezes
 * (artigo, oferta, lugar, especialista).
 *
 * ## Por que não `fileLifecycle`
 *
 * A F8 já resolveu ordem e falha parcial para os buckets **privados**, e a
 * tentação era reusar aquele módulo. A semântica é oposta em dois pontos:
 *
 *   - lá o arquivo sai **antes** da linha, e a exclusão é **abortada** se o
 *     arquivo sobreviver (`OrphanFileError`), porque um documento de viagem que
 *     continua acessível por URL assinada é o defeito P-07 em pessoa;
 *   - aqui o arquivo é público, some da tela sozinho quando o registro sai, e
 *     abortar a exclusão de um artigo porque o Storage recusou apagar a capa
 *     deixaria no ar justamente o conteúdo que o administrador mandou tirar.
 *
 * Além disso `fileLifecycle` autoriza o caminho por `auth.uid()`; em `content`
 * não existe dono, existe `is_admin()`. Reaproveitar aquilo aqui rejeitaria
 * todo caminho — os prefixos não são uid.
 *
 * ## A autoridade continua sendo a policy
 *
 * Nada neste arquivo decide quem pode escrever. Quem decide é `content_write`
 * (`0007`), que confere `is_admin()` no servidor. Um usuário comum que chame
 * `salvarComImagemEditorial` direto do console recebe a recusa do Storage —
 * e o registro não chega a ser gravado, porque o upload falha primeiro.
 */

import type { ContentImageKind } from '@/domain/upload';
import { dataSource } from './index';
import type { StoredFile, UploadableFile } from './types';

/**
 * O que o módulo precisa saber fazer com arquivo. Existe como parâmetro para o
 * teste conseguir provocar as falhas parciais que a produção não provoca sob
 * demanda — upload que falha, remoção que falha — sem tocar em rede.
 */
export interface EditorialImagePort {
  upload(kind: ContentImageKind, entityId: string, file: UploadableFile): Promise<StoredFile>;
  remove(
    kind: ContentImageKind,
    entityId: string,
    imageUrl: string | null | undefined,
  ): Promise<void>;
}

export const defaultEditorialImagePort: EditorialImagePort = {
  upload: (kind, entityId, file) => dataSource.content.uploadEditorialImage(kind, entityId, file),
  remove: (kind, entityId, imageUrl) =>
    dataSource.content.removeEditorialImage(kind, entityId, imageUrl),
};

/**
 * `undefined` = mantém a imagem atual; `null` = o administrador removeu a
 * imagem; um arquivo = trocar por este.
 *
 * Os três casos precisam ser distinguíveis: "não mexi na imagem" e "apaguei a
 * imagem" produzem gravações diferentes, e um único campo opcional confundiria
 * os dois.
 */
export type PendingEditorialImage = UploadableFile | null | undefined;

export interface SaveWithEditorialImageInput<T> {
  kind: ContentImageKind;
  /**
   * O id do registro — precisa existir **antes** do upload, porque é ele que
   * compõe o caminho no bucket. Nos formulários o id de um cadastro novo é
   * gerado na tela (`createId()`), não pelo banco, então isto já é verdade sem
   * nenhuma ida ao servidor.
   */
  entityId: string;
  /** O que está gravado hoje. Pode ser URL externa legada — e aí não é tocada. */
  currentImageUrl?: string;
  pendingImage: PendingEditorialImage;
  /** Grava o registro com a URL final da imagem. */
  persist(imageUrl: string | undefined): Promise<T>;
  port?: EditorialImagePort;
}

/**
 * Sobe a imagem nova, grava o registro e só então remove a anterior.
 *
 * As três falhas possíveis, e o que cada uma deixa para trás:
 *
 *   1. **upload falha** → nada foi gravado. O registro continua como estava
 *      (ou não existe, se era novo) e o administrador vê o erro. Retry limpo.
 *   2. **gravação falha depois do upload** → a imagem nova não é de ninguém,
 *      então ela é removida antes de o erro subir. Sem isso, cada tentativa
 *      fracassada deixaria um arquivo no bucket para sempre.
 *   3. **remoção da anterior falha** → a troca já deu certo e está gravada.
 *      Desfazer seria pior: o administrador veria um erro depois de a imagem
 *      já ter mudado. Fica o aviso no log e um arquivo a mais no bucket.
 *
 * O que **não** acontece em nenhum caminho: apagar a imagem antiga antes de a
 * nova estar no ar.
 */
export async function saveWithEditorialImage<T>({
  kind,
  entityId,
  currentImageUrl,
  pendingImage,
  persist,
  port = defaultEditorialImagePort,
}: SaveWithEditorialImageInput<T>): Promise<T> {
  // Sem troca de imagem não há nada a coordenar: é uma gravação comum, e o
  // valor que já estava lá continua valendo (inclusive quando é do Unsplash).
  if (pendingImage === undefined) {
    return persist(currentImageUrl);
  }

  // Remoção explícita: o registro perde a referência primeiro, e o arquivo sai
  // depois. Se a remoção do arquivo falhar, a imagem já não aparece em lugar
  // nenhum — o inverso deixaria o conteúdo apontando para um arquivo apagado.
  if (pendingImage === null) {
    const saved = await persist(undefined);
    await discard(port, kind, entityId, currentImageUrl);
    return saved;
  }

  const stored = await port.upload(kind, entityId, pendingImage);

  let saved: T;
  try {
    saved = await persist(stored.url);
  } catch (error) {
    await discard(port, kind, entityId, stored.url);
    throw error;
  }

  if (currentImageUrl && currentImageUrl !== stored.url) {
    await discard(port, kind, entityId, currentImageUrl);
  }

  return saved;
}

export interface DeleteWithEditorialImageInput {
  kind: ContentImageKind;
  entityId: string;
  imageUrl?: string;
  /** Apaga o registro. */
  removeRecord(): Promise<void>;
  port?: EditorialImagePort;
}

/**
 * Apaga o registro e depois a imagem que ele mantinha.
 *
 * Registro primeiro, ao contrário dos arquivos privados da F8. O motivo é a
 * visibilidade: enquanto a linha existir, o conteúdo continua na Comunidade ou
 * na Home. Tirar a capa antes deixaria no ar um artigo publicado sem imagem —
 * um defeito que o **usuário** vê — para evitar um arquivo órfão que só a
 * administração veria.
 *
 * Se a remoção do arquivo falhar, o erro não sobe: o que o administrador pediu
 * (tirar o conteúdo do ar) aconteceu. O caminho fica no log.
 */
export async function deleteWithEditorialImage({
  kind,
  entityId,
  imageUrl,
  removeRecord,
  port = defaultEditorialImagePort,
}: DeleteWithEditorialImageInput): Promise<void> {
  await removeRecord();
  await discard(port, kind, entityId, imageUrl);
}

/**
 * Remoção que nunca derruba a operação de cima.
 *
 * `port.remove` já ignora URL externa e caminho de outro registro; o `catch`
 * cobre o resto — rede caída, policy recusando, objeto que sumiu por fora.
 */
async function discard(
  port: EditorialImagePort,
  kind: ContentImageKind,
  entityId: string,
  imageUrl: string | null | undefined,
): Promise<void> {
  if (!imageUrl) return;
  try {
    await port.remove(kind, entityId, imageUrl);
  } catch {
    console.warn('imagem_editorial_nao_removida', { kind, entityId });
  }
}
