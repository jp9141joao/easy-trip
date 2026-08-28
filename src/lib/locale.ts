/**
 * O idioma de quem está usando o aplicativo (§12 do handoff).
 *
 * DE ONDE ELE VEM
 *
 * Do aparelho, via `expo-localization`. O Easy Trip não tem — hoje — tela de
 * preferência de idioma, e nenhum campo de perfil o guarda: a interface é
 * escrita em português e a formatação de data e dinheiro usa `pt-BR` fixo.
 *
 * Escrever `'pt-BR'` também aqui teria sido a saída fácil e errada. A pergunta
 * que este módulo responde não é "em que língua está a interface", é "que
 * língua esta pessoa fala" — e um aparelho configurado em inglês responde
 * `en`, mesmo com o aplicativo em português. A regra do idioma do destino
 * (§11) fica correta nos dois casos, e no dia em que existir preferência
 * persistida o único lugar a mudar é este.
 *
 * POR QUE NÃO É UM HOOK COM ESTADO
 *
 * O locale do sistema não muda enquanto a tela está aberta — mudá-lo no Android
 * reinicia a atividade. Uma leitura direta basta, e evita um `useState` que
 * nunca receberia um segundo valor.
 */

import { getLocales } from 'expo-localization';

/**
 * O último recurso, quando o sistema não informa locale nenhum.
 *
 * `pt` porque é a língua em que o aplicativo inteiro está escrito — quem chega
 * aqui está lendo português na tela neste momento. Não é um palpite sobre a
 * pessoa; é a única evidência disponível.
 */
const FALLBACK_LANGUAGE = 'pt';

/**
 * A etiqueta de idioma do aparelho — `pt-BR`, `en-US`, `ja-JP`.
 *
 * `getLocales()` lê um módulo nativo. Em teste, em web e num aparelho com
 * configuração incompleta ele pode devolver lista vazia ou lançar; nenhum desses
 * casos justifica derrubar uma tela de viagem, então a falha vira o padrão.
 */
export function getUserLanguageTag(): string {
  try {
    const [primary] = getLocales();
    return primary?.languageTag || primary?.languageCode || FALLBACK_LANGUAGE;
  } catch {
    return FALLBACK_LANGUAGE;
  }
}

/**
 * Só a família — `pt` de `pt-BR`, `en` de `en-GB`.
 *
 * É o que a comparação com o idioma do destino usa: a variante regional não
 * muda a resposta de "eu me viro falando o que já falo?" (§12).
 */
export function getUserLanguage(): string {
  const tag = getUserLanguageTag();
  return tag.trim().toLowerCase().split(/[-_]/)[0] || FALLBACK_LANGUAGE;
}
