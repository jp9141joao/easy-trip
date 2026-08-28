/**
 * Regras da capa da viagem (§3–§6 do handoff).
 *
 * O QUE ESTE MÓDULO É
 *
 * A política, em função pura: o que serve como capa e onde o arquivo mora. Sem
 * rede e sem Storage, para o aparelho recusar a imagem antes de gastar upload e
 * para o caminho no bucket nunca ser montado com texto vindo da galeria.
 *
 * NÃO É O CONTROLE DE SEGURANÇA
 *
 * O controle é o banco. A migration que cria o bucket `trip-covers` põe
 * `file_size_limit` e `allowed_mime_types` nele, e as policies de Storage
 * amarram leitura à participação na viagem e escrita à propriedade dela. Aqui é
 * a primeira barreira — a que dá uma resposta útil em vez de um erro de upload
 * dez segundos depois.
 *
 * POR QUE NÃO REAPROVEITAR `CONTENT_IMAGE_POLICY`
 *
 * O bucket `content` é PÚBLICO: é onde mora imagem editorial, feita para
 * aparecer sem sessão. A capa de uma viagem privada não pode ganhar URL pública
 * permanente (§5) — quem tem o link veria para onde a pessoa vai e quando. Os
 * limites numéricos coincidem por enquanto; a política é outra, e juntá-las
 * faria a próxima mudança em uma valer para a outra sem que ninguém decidisse.
 */

import { validateUpload, type UploadPolicy, type UploadValidation } from './upload';

/**
 * Capa de viagem: só imagem, 5 MB.
 *
 * PDF fica de fora — a capa é renderizada por `AppImage` num hero de 240 pt de
 * altura, e um PDF viraria um quadro quebrado. HEIC também: o iPhone o entrega
 * por padrão, o Android não o exibe, e aceitá-lo produziria capas invisíveis
 * para metade dos aparelhos. O `ImagePicker` converte para JPEG quando
 * `allowsEditing` está ligado, que é como a tela o chama.
 *
 * 5 MB pelo mesmo motivo do avatar: barrar o disparate sem apertar o caso
 * normal, que sai do seletor com algumas centenas de kB.
 */
export const TRIP_COVER_POLICY: UploadPolicy = {
  mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  maxBytes: 5 * 1024 * 1024,
  mimeMessage: 'Escolha uma imagem JPG, PNG ou WEBP para a capa.',
};

export function validateTripCover(candidate: {
  name: string;
  mimeType: string;
  size?: number;
}): UploadValidation {
  return validateUpload(candidate, TRIP_COVER_POLICY);
}

/**
 * Caminho da capa dentro do bucket `trip-covers`.
 *
 * O PRIMEIRO SEGMENTO É O `tripId`, e não o `auth.uid()`.
 *
 * É a diferença que faz a colaboração funcionar. Os buckets privados de 0002
 * são namespaced por usuário, e a policy compara o prefixo com `auth.uid()`:
 * uma capa gravada em `{dono}/…` seria ilegível para o editor convidado, que
 * veria a viagem com um retângulo cinza. Namespaced por viagem, a policy
 * pergunta "quem lê é membro DESTA viagem?" — que é a pergunta certa, e a
 * mesma que `can_read_shared_attachment` já faz para reservas compartilhadas.
 *
 * O nome vindo da galeria não entra. Ele pode conter `../`, barras ou
 * percent-encoding, e é o primeiro segmento que decide de quem é a pasta.
 *
 * O sufixo aleatório existe para o arquivo novo nunca cair sobre o antigo:
 * sobrescrever o mesmo objeto deixaria a URL assinada anterior servindo o
 * conteúdo trocado até expirar — e a capa antiga continuaria aparecendo para
 * quem tivesse a tela aberta.
 */
export function tripCoverStoragePath(tripId: string, extension: string, unique: string): string {
  return `${tripId}/cover-${unique}.${extension}`;
}

/**
 * O caminho pertence mesmo a esta viagem?
 *
 * O caminho é montado por `tripCoverStoragePath`, então ele próprio prova de
 * quem é o arquivo. Sem esta conferência, um valor colado à mão na coluna
 * transformaria "trocar a capa desta viagem" em "apagar a capa de outra" — o
 * mesmo raciocínio de `managedPathBelongsTo` para imagem editorial.
 */
export function coverPathBelongsTo(path: string, tripId: string): boolean {
  const segments = path.split('/');
  return segments.length === 2 && segments[0] === tripId;
}

/**
 * A URI que a tela deve renderizar como capa.
 *
 * A ORDEM É A REGRA (§3): capa própria primeiro, sugerida depois, nada por
 * último — e `AppImage` desenha o degradê da marca quando recebe `undefined`.
 *
 * Existe como função, e não como campo, porque é derivada de dois campos que
 * mudam por caminhos diferentes: `coverImageSignedUrl` expira em uma hora e é
 * recalculado a cada leitura; `coverImageUrl` é a URL do catálogo, gravada uma
 * vez na criação. Guardar o resultado numa terceira coluna seria guardar a
 * resposta de uma pergunta que muda sozinha.
 *
 * Remover a capa própria devolve a viagem à sugerida sem precisar reconstruí-la
 * (§3): ela nunca foi apagada — ficou embaixo o tempo todo.
 */
export function tripCoverUri(trip: {
  coverImageSignedUrl?: string;
  coverImageUrl?: string;
}): string | undefined {
  return trip.coverImageSignedUrl ?? trip.coverImageUrl;
}
