/**
 * A fronteira com o sistema operacional para deep links.
 *
 * Fica isolada num módulo próprio porque é justamente a parte que não dá para
 * exercitar num teste: quem entrega a URL é o Android/iOS. Mantendo aqui as
 * três chamadas do `expo-linking`, tudo que decide o que fazer com a URL
 * (`authLinking.ts`) continua sendo função pura.
 */

import * as Linking from 'expo-linking';

/** URL que abriu o aplicativo, quando ele estava fechado. */
export async function getInitialUrl(): Promise<string | null> {
  try {
    return await Linking.getInitialURL();
  } catch {
    return null;
  }
}

/** URLs que chegam com o aplicativo já aberto. Devolve o cancelamento. */
export function subscribeToUrls(listener: (url: string) => void): () => void {
  const subscription = Linking.addEventListener('url', ({ url }) => listener(url));
  return () => subscription.remove();
}

/**
 * Endereço de retorno para o e-mail de recuperação.
 *
 * `createURL` resolve sozinho a diferença entre Expo Go (`exp://…`) e build
 * standalone (`easytrip://…`) — que é exatamente o motivo de não escrever uma
 * URL fixa aqui: a de produção não funcionaria em desenvolvimento, e vice-versa.
 */
export function createRedirectUrl(path: string): string | undefined {
  try {
    return Linking.createURL(path);
  } catch {
    return undefined;
  }
}
