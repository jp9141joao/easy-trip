/**
 * WhatsApp comercial do Easy Trip.
 *
 * Deliberadamente separado de `WHATSAPP_COMMUNITY_URL` (§6). São coisas
 * diferentes com ciclos de vida diferentes: o convite da comunidade é um grupo
 * que pode ser recriado a qualquer momento; este é o canal de atendimento. Se
 * um mudar, o outro não deve mudar junto — e é justamente por isso que não
 * compartilham configuração.
 *
 * O número é público (está no rodapé de qualquer site comercial), então mora no
 * cliente sem problema. O que nunca pode morar aqui é chave de API.
 *
 * Formato: somente dígitos, com código do país. Brasil = 55 + DDD + número.
 * Exemplo: `5511987654321`.
 */
export const EASYTRIP_CONTACT_WHATSAPP = '';

/**
 * Um número em formato internacional utilizável pelo `wa.me`.
 *
 * Enquanto estiver vazio ou malformado, a ação é tratada como não configurada:
 * o botão não aparece, em vez de aparecer e falhar (§12, §34).
 */
export function isContactWhatsappConfigured(
  value: string = EASYTRIP_CONTACT_WHATSAPP,
): boolean {
  // 10 a 15 dígitos cobre de números nacionais curtos ao teto do padrão E.164.
  return /^[1-9]\d{9,14}$/.test(value.trim());
}

/**
 * Endereço de conversa com mensagem pré-preenchida.
 *
 * `https://wa.me/...` e não `whatsapp://send`: o endereço HTTPS é entregue ao
 * aplicativo quando ele está instalado e abre no navegador quando não está, o
 * que faz o mesmo link servir aos dois casos sem detecção de plataforma (§7).
 */
export function buildWhatsappUrl(message: string, phone: string = EASYTRIP_CONTACT_WHATSAPP): string {
  return `https://wa.me/${phone.trim()}?text=${encodeURIComponent(message)}`;
}
