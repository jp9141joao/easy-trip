/**
 * `expo-crypto` fora do aparelho.
 *
 * `@/lib/id` usa `Crypto.randomUUID()`, e importá-lo puxa `expo-modules-core`,
 * que não roda no `node` puro. Este substituto existe SÓ para a avaliação da
 * IA, e só é usado quando `EVAL_STUB_EXPO=1` — nunca por acaso.
 *
 * A troca é honesta porque nada do que se mede depende dela: `createId` dá
 * identidade LOCAL a uma proposta na tela de revisão, e nenhuma asserção da
 * avaliação olha para esse valor. Se algum dia olhar, este arquivo passa a ser
 * uma mentira e o teste tem de ir para o Jest.
 */
export function randomUUID() {
  return 'eval-' + Math.random().toString(16).slice(2, 10) + '-0000-4000-8000-000000000000';
}
export default { randomUUID };
