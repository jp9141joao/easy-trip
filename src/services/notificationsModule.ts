/**
 * A porta de entrada para `expo-notifications` (§33).
 *
 * POR QUE ESTE ARQUIVO EXISTE
 *
 * A partir do SDK 53 o Expo Go deixou de embarcar a parte de push REMOTO do
 * `expo-notifications`. E o aviso disso não espera ninguém chamar nada: o
 * índice do pacote carrega `DevicePushTokenAutoRegistration.fx`, que registra
 * um ouvinte de token no escopo do módulo — e esse ouvinte, dentro do Expo Go,
 * imprime `console.error` no Android. Ou seja, o erro nasce da linha
 *
 *     import * as Notifications from 'expo-notifications'
 *
 * e não de uma chamada nossa. Como o Expo Router carrega todas as rotas ao
 * abrir, um import estático em QUALQUER tela põe a tela vermelha na Home.
 *
 * A saída é não deixar o módulo ser AVALIADO no Expo Go. O `require` abaixo
 * continua sendo estático para o empacotador (o Metro segue enxergando a
 * dependência e a inclui no pacote, o que preserva o push nas builds reais),
 * mas a fábrica do módulo só roda quando alguém chama `getNotificationsModule`
 * — e ela só chama em ambiente compatível.
 *
 * O QUE ESTE ARQUIVO NÃO FAZ
 *
 * Não silencia erro nenhum. Em development build, APK/AAB ou build do EAS o
 * módulo carrega normalmente e qualquer falha real continua aparecendo. O que
 * se trata aqui é uma limitação conhecida do AMBIENTE Expo Go, não um defeito
 * do Easy Trip nem do produto instalado.
 */

import Constants, { ExecutionEnvironment } from 'expo-constants';

/** O módulo real, tipado sem ser importado: `typeof import` some na compilação. */
export type NotificationsModule = typeof import('expo-notifications');

/**
 * Estamos dentro do Expo Go?
 *
 * `Constants.executionEnvironment` é a API oficial do `expo-constants` (18.x) e
 * vem do lado nativo: o Expo Go responde `storeClient`; development build,
 * APK/AAB e build do EAS respondem `bare` ou `standalone`. Não se olha
 * plataforma — Android instalado não é Android no Expo Go — nem user agent.
 */
export function isExpoGo(): boolean {
  return Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
}

/**
 * Há como receber push remoto neste ambiente?
 *
 * A decisão mora aqui, e só aqui, para que nenhuma tela precise saber o que é
 * Expo Go. Web não entra na conta: lá o módulo carrega e a ausência de token é
 * resolvida em `getDeviceToken`, como sempre foi.
 */
export function isRemotePushSupported(): boolean {
  return !isExpoGo();
}

let cache: NotificationsModule | null | undefined;

/**
 * O módulo, ou `null` quando o ambiente não o suporta.
 *
 * `null` é uma resposta, não uma falha: quem chama devolve "indisponível" e o
 * aplicativo segue — os avisos internos do Easy Trip não passam por aqui.
 */
export function getNotificationsModule(): NotificationsModule | null {
  if (cache !== undefined) return cache;

  if (!isRemotePushSupported()) {
    cache = null;
    return cache;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cache = require('expo-notifications') as NotificationsModule;
  } catch {
    // Ambiente sem o módulo nativo (Node, testes de domínio). Não é erro:
    // é a mesma resposta que o Expo Go recebe.
    cache = null;
  }
  return cache;
}

/** Só para os testes: esquece a decisão já tomada. */
export function __resetNotificationsModule(): void {
  cache = undefined;
}
