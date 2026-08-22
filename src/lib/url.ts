/**
 * URLs externas cadastradas por um administrador (§11).
 *
 * O administrador é confiável, mas não é infalível: ele cola o que o navegador
 * mostrou, e o que o navegador mostra frequentemente não tem protocolo. Por isso
 * a normalização existe — para aceitar `maps.google.com/...` sem transformar
 * isso num campo que o usuário precise digitar corretamente.
 *
 * O que a normalização **não** faz é aceitar qualquer esquema. Um link é aberto
 * pelo `Linking`/navegador do aparelho, e esquemas como `javascript:`, `file:` e
 * `intent:` não são links: são instruções. Só `http` e `https` passam, e `http`
 * é promovido a `https`.
 */

const WEB_SCHEMES = ['http:', 'https:'];

/**
 * Devolve a URL pronta para abrir, ou `null` se não for um endereço web válido.
 *
 * `null` é sempre tratado como "não há link" — é o mesmo caminho de código do
 * campo vazio, então uma URL inválida nunca vira um botão que falha ao toque.
 */
export function normalizeExternalUrl(raw: string | undefined | null): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;

  // Sem `//` não existe host para o `URL` interpretar: `URL('exemplo.com')`
  // falha, e `URL('mailto:x')` não falha mas também não é um link web. Só
  // completamos o que claramente é um endereço sem protocolo.
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  if (!WEB_SCHEMES.includes(parsed.protocol)) return null;
  // Um host precisa ter ao menos um ponto: `https://foo` não leva a lugar nenhum.
  if (!parsed.hostname.includes('.')) return null;

  // Promover http a https é seguro: se o destino não atender em TLS, o problema
  // aparece no navegador, e não vale a pena abrir em claro por precaução.
  if (parsed.protocol === 'http:') parsed.protocol = 'https:';

  return parsed.toString();
}

const GOOGLE_HOSTS = /(^|\.)(google\.[a-z.]+|goo\.gl)$/i;

/**
 * Rótulo do botão, derivado do próprio endereço (§10).
 *
 * Derivar em vez de perguntar economiza um campo no formulário e elimina a
 * possibilidade de o rótulo discordar do link — que é o que aconteceria se o
 * administrador escolhesse "Ver site" e depois trocasse a URL por um mapa.
 */
export function externalLinkLabel(url: string | null): string {
  if (!url) return 'Ver site';
  try {
    const host = new URL(url).hostname;
    if (GOOGLE_HOSTS.test(host) || host === 'maps.app.goo.gl') return 'Ver no Google';
    return 'Ver site';
  } catch {
    return 'Ver site';
  }
}
