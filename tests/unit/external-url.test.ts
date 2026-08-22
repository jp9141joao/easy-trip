import { externalLinkLabel, normalizeExternalUrl } from '@/lib/url';

/**
 * Link externo cadastrado pelo administrador (§11, §62).
 *
 * O que precisa ser verdade: o que o admin colar do navegador funciona, e o que
 * não é um link web não vira botão.
 */

describe('normalizeExternalUrl', () => {
  it('accepts what an administrator actually pastes', () => {
    expect(normalizeExternalUrl('https://exemplo.com/hotel')).toBe('https://exemplo.com/hotel');
    // Sem protocolo é o caso mais comum — a barra do navegador esconde o https.
    expect(normalizeExternalUrl('exemplo.com')).toBe('https://exemplo.com/');
    expect(normalizeExternalUrl('  www.exemplo.com/x  ')).toBe('https://www.exemplo.com/x');
  });

  it('promotes http to https', () => {
    expect(normalizeExternalUrl('http://exemplo.com/')).toBe('https://exemplo.com/');
  });

  it('preserves query strings, which Google Maps links depend on', () => {
    const url = 'https://www.google.com/maps/search/?api=1&query=Hotel+Lumiere';
    expect(normalizeExternalUrl(url)).toContain('query=Hotel+Lumiere');
  });

  it('refuses anything that is not a web address', () => {
    // `javascript:` e `data:` não são endereços, são instruções; `file:` e
    // `intent:` alcançam o aparelho. Nenhum deles pode virar um botão (§11).
    for (const value of [
      '',
      '   ',
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html,<script>x</script>',
      'file:///etc/passwd',
      'intent://scan#Intent;scheme=zxing;end',
      'tel:+5511999999999',
      'não é uma url',
      'localhost',
    ]) {
      expect(normalizeExternalUrl(value)).toBeNull();
    }
  });

  it('returns null for missing values so the caller has one empty case', () => {
    expect(normalizeExternalUrl(undefined)).toBeNull();
    expect(normalizeExternalUrl(null)).toBeNull();
  });
});

describe('externalLinkLabel', () => {
  it('says "Ver no Google" for Google destinations', () => {
    expect(externalLinkLabel('https://www.google.com/maps/place/x')).toBe('Ver no Google');
    expect(externalLinkLabel('https://google.com.br/search?q=x')).toBe('Ver no Google');
    expect(externalLinkLabel('https://maps.app.goo.gl/abc')).toBe('Ver no Google');
  });

  it('says "Ver site" for everything else', () => {
    expect(externalLinkLabel('https://hotellumiere.fr')).toBe('Ver site');
    expect(externalLinkLabel('https://booking.com/x')).toBe('Ver site');
    // Não pode casar com um domínio que apenas contém "google".
    expect(externalLinkLabel('https://googleblog.example.com')).toBe('Ver site');
    expect(externalLinkLabel(null)).toBe('Ver site');
  });
});
