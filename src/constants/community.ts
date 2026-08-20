/**
 * Comunidade do Easy Trip no WhatsApp.
 *
 * Este é o **único lugar** onde o convite mora: se o link mudar, muda aqui e
 * mais nada precisa ser tocado.
 *
 * Precisa ser um convite `https://chat.whatsapp.com/...`, e não um deep link
 * `whatsapp://`. O endereço HTTPS abre no aplicativo quando ele está instalado
 * e, quando não está, continua abrindo no navegador — que é o que garante que
 * ninguém fique de fora por não ter o WhatsApp no aparelho.
 *
 * Enquanto estiver vazio, o convite é tratado como não configurado: o cartão
 * continua na Home, mas o botão avisa em vez de fingir que abriu alguma coisa.
 */
export const WHATSAPP_COMMUNITY_URL = '';

/** Um convite de comunidade servido por HTTPS — o que abre com e sem o app. */
export function isCommunityInviteConfigured(url: string = WHATSAPP_COMMUNITY_URL): boolean {
  return /^https:\/\/(chat\.whatsapp\.com|wa\.me)\/\S+$/.test(url.trim());
}
