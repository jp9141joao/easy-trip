import type { SupabaseClient } from '@supabase/supabase-js';

import { deleteMirror } from '@/lib/fileMirror';

/**
 * Ciclo de vida dos arquivos presos a um registro — o defeito P-07.
 *
 * Definição original (§31): "Excluir um `ticket` ou uma `insurance_policy`
 * apaga a linha mas **não** o arquivo no Storage (o diário já faz certo)".
 * Risco Médio: "arquivos órfãos acumulam e continuam acessíveis por URL
 * assinada até expirar".
 *
 * ## O que o Storage do Supabase realmente responde
 *
 * Medido contra a pilha local, `DELETE /storage/v1/object/{bucket}` devolve
 * **HTTP 200 com `[]`** em três situações completamente diferentes:
 *
 *   1. a policy barrou a remoção  → o arquivo continua lá;
 *   2. o objeto já não existia    → nada a fazer;
 *   3. segunda tentativa após remover → nada a fazer.
 *
 * E devolve a lista dos objetos removidos quando de fato removeu. Ou seja:
 * **`error` nunca chega preenchido**, e um `if (error) throw` — que é o reflexo
 * natural — não detectaria nada. A única evidência de que a remoção aconteceu é
 * o conteúdo do array devolvido.
 *
 * ## Ordem das operações
 *
 * Arquivo primeiro, linha depois. As duas operações são idempotentes, então
 * repetir a exclusão converge de qualquer ponto:
 *
 *   - remoção do arquivo falha → **nada é apagado**; o registro continua de pé,
 *     apontando para um arquivo que continua existindo. Nada se perdeu e a
 *     tentativa seguinte recomeça do zero.
 *   - remoção da linha falha → o arquivo já se foi e o registro fica órfão do
 *     próprio anexo. É visível para o usuário (o botão de abrir some) e a
 *     tentativa seguinte apaga a linha, com a remoção do arquivo virando um
 *     no-op.
 *
 * A ordem inversa — linha primeiro — troca um estado visível e recuperável por
 * exatamente o que o P-07 descreve: lixo invisível e permanente, porque a linha
 * que guardava o caminho já não existe para dizer o que remover.
 */

export interface FileLifecycleDeps {
  db: () => SupabaseClient;
  /** UID da sessão. Autoriza o caminho — nunca o valor gravado na linha. */
  userId: string | null;
}

export class OrphanFileError extends Error {
  constructor(readonly paths: string[]) {
    super('Não foi possível remover o arquivo associado. Tente novamente.');
    this.name = 'OrphanFileError';
  }
}

/**
 * O caminho pertence a quem está pedindo a exclusão?
 *
 * O valor vem de uma coluna, e uma coluna não autoriza nada (§47). A RLS já
 * garantiu que o usuário pode apagar **a linha**; isto garante que ele não
 * consegue usar essa linha para mandar apagar o **arquivo de outra pessoa**.
 * Sem esta conferência, gravar `file_path = '{uid-de-B}/…'` na própria linha
 * transformaria "excluir meu ticket" em "apagar o documento do vizinho".
 *
 * Na prática a policy de Storage também barra — mas ela barra em silêncio, com
 * 200 e `[]`, e aí a exclusão pararia por um motivo que ninguém entenderia.
 */
export function ownsPath(userId: string | null, storagePath: string): boolean {
  if (!userId) return false;
  return storagePath.split('/')[0] === userId;
}

/**
 * Remove objetos do Storage e confirma que sumiram.
 *
 * Devolve os caminhos que **continuam existindo** depois da tentativa. Vazio
 * significa sucesso — incluindo o caso em que o objeto já não estava lá.
 */
export async function removeObjects(
  { db, userId }: FileLifecycleDeps,
  bucket: string,
  paths: string[],
): Promise<string[]> {
  const alvos = paths.filter(Boolean);
  if (alvos.length === 0) return [];

  // Caminho de terceiro nem chega a ser tentado.
  const proprios = alvos.filter((p) => ownsPath(userId, p));
  const alheios = alvos.filter((p) => !ownsPath(userId, p));

  const removidos = new Set<string>();
  if (proprios.length > 0) {
    const { data } = await db().storage.from(bucket).remove(proprios);
    for (const objeto of data ?? []) removidos.add(objeto.name);
  }

  // O que não voltou na lista pode ter sido barrado **ou** já não existir. As
  // duas respostas são idênticas, então a única saída é olhar: uma listagem por
  // prefixo diz qual dos dois é. Só roda no caso incomum.
  const duvidosos = proprios.filter((p) => !removidos.has(p));
  const sobreviventes: string[] = [...alheios];

  for (const path of duvidosos) {
    if (await objectExists(db, bucket, path)) sobreviventes.push(path);
  }
  return sobreviventes;
}

async function objectExists(
  db: () => SupabaseClient,
  bucket: string,
  path: string,
): Promise<boolean> {
  const segments = path.split('/');
  const name = segments.pop()!;
  const { data } = await db()
    .storage.from(bucket)
    .list(segments.join('/'), { limit: 100, search: name });
  return (data ?? []).some((o) => o.name === name);
}

/**
 * Apaga o arquivo (remoto e local) e só então a linha.
 *
 * `deleteRow` é passada de fora porque cada entidade apaga a sua tabela com a
 * sua condição; o que se centraliza aqui é a **ordem** e o **tratamento de
 * falha parcial**, que era o que estava espalhado e incompleto.
 */
export async function deleteWithFiles(
  deps: FileLifecycleDeps,
  bucket: string,
  paths: (string | null | undefined)[],
  deleteRow: () => Promise<void>,
): Promise<void> {
  const alvos = paths.filter((p): p is string => Boolean(p));

  const sobreviventes = await removeObjects(deps, bucket, alvos);
  if (sobreviventes.length > 0) {
    // Interrompe **antes** de apagar a linha: é ela que guarda o caminho, e sem
    // ela ninguém mais sabe o que limpar. Nada foi destruído, então repetir é
    // seguro.
    throw new OrphanFileError(sobreviventes);
  }

  // A cópia local sai junto — "a exclusão precisa remover as duas" (D-04).
  for (const path of alvos) deleteMirror(bucket, path);

  await deleteRow();
}
