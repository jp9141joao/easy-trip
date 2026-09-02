import { Dimensions } from 'react-native';

/**
 * Um aparelho de verdade, para os testes que decidem layout por largura.
 *
 * O preset de jest do React Native devolve `{ width: 750, fontScale: 2 }` — um
 * valor de fixture, não de aparelho. Enquanto nada dependia de `fontScale` isso
 * era inofensivo; a partir do momento em que `AdaptiveButtonRow` passou a
 * considerar a preferência de texto do sistema, a fixture passaria a descrever
 * um celular imaginário com o texto no dobro do tamanho, e as expectativas de
 * "cabe na fileira" deixariam de falar do aparelho que elas dizem medir.
 *
 * Quem quiser testar texto ampliado passa `fontScale` explicitamente — que é
 * como isso deve aparecer num teste: escrito, não herdado.
 *
 * O NOME NÃO COMEÇA COM `use`. Ele chegou a se chamar `useDevice`, e o
 * `react-hooks/rules-of-hooks` recusava os três arquivos que o chamavam: pela
 * convenção do React, `useAlgo` no topo de um módulo é um Hook chamado fora de
 * componente. Isto não é Hook nenhum — é um registrador de `beforeEach`, e o
 * lugar dele é justamente o topo do arquivo. Quem estava errado era o nome.
 */
export function mockDeviceMetrics(
  { width = 390, height = 844, fontScale = 1 }: { width?: number; height?: number; fontScale?: number } = {},
) {
  beforeEach(() => {
    jest
      .spyOn(Dimensions, 'get')
      .mockReturnValue({ width, height, scale: 3, fontScale });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });
}

/** Troca o aparelho no meio de um teste, para comparar dois tamanhos de texto. */
export function janela({
  width = 390,
  height = 844,
  fontScale = 1,
}: { width?: number; height?: number; fontScale?: number } = {}) {
  jest.spyOn(Dimensions, 'get').mockReturnValue({ width, height, scale: 3, fontScale });
}
