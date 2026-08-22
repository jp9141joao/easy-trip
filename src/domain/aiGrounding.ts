import { normalizeKey } from '@/data/images';
import type { GeneratedPlaceDraft } from './schemas';

/**
 * Segunda barreira contra fatos inventados sobre estabelecimentos reais
 * (§22, §23, §24, §58, §65).
 *
 * O schema já impede a *categoria* de campo perigosa (nota, preço, horários não
 * existem na saída). Falta o problema mais sutil: o modelo devolver um endereço
 * ou um telefone plausível para um lugar que existe de verdade. O prompt pede
 * que ele não faça isso, mas prompt é pedido, não garantia — e a consequência
 * de ele ignorar é o Easy Trip publicar o telefone errado de um hotel real.
 *
 * Por isso a verificação não é de forma, é de *procedência*: um dado factual só
 * passa se puder ser rastreado até o briefing que o próprio administrador
 * escreveu. Se não estava lá, o modelo não tinha como saber, e o campo volta
 * vazio para o administrador preencher.
 *
 * O que é criativo — descrição, apresentação — passa sem verificação: é o
 * trabalho que se está pedindo à IA (§23).
 */

/** Cobertura mínima de tokens para considerar um valor rastreável ao briefing. */
const MIN_COVERAGE = 0.6;

function tokens(value: string): string[] {
  return normalizeKey(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);
}

/**
 * Cobertura em vez de igualdade exata: o modelo reformata ("Rua Augusta, 100" →
 * "Rua Augusta, 100 — Consolação"), e exigir a string idêntica descartaria
 * endereços legítimos que o administrador de fato forneceu.
 */
function isGrounded(value: string, briefing: string): boolean {
  const needed = tokens(value);
  if (needed.length === 0) return false;
  const haystack = new Set(tokens(briefing));
  const found = needed.filter((token) => haystack.has(token)).length;
  return found / needed.length >= MIN_COVERAGE;
}

/** Telefone se compara por dígitos: formatação não é informação. */
function phoneIsGrounded(value: string, briefing: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 8) return false;
  return briefing.replace(/\D/g, '').includes(digits);
}

/** Numa URL o que importa é o destino — o caminho o modelo pode ter completado. */
function urlIsGrounded(value: string, briefing: string): boolean {
  const host = value
    .replace(/^[a-z]+:\/\//i, '')
    .split('/')[0]
    .replace(/^www\./i, '')
    .toLowerCase();
  if (!host.includes('.')) return false;
  return briefing.toLowerCase().includes(host);
}

export interface GroundingResult {
  draft: GeneratedPlaceDraft;
  /** Campos removidos por não constarem do briefing — mostrados ao admin. */
  dropped: string[];
}

export function groundPlaceDraft(
  draft: GeneratedPlaceDraft,
  briefing: string,
): GroundingResult {
  const dropped: string[] = [];
  const next: GeneratedPlaceDraft = { ...draft };

  const check = (field: 'name' | 'city' | 'country' | 'address', label: string) => {
    const value = next[field];
    if (value && !isGrounded(value, briefing)) {
      delete next[field];
      dropped.push(label);
    }
  };

  check('name', 'nome');
  check('city', 'cidade');
  check('country', 'país');
  check('address', 'endereço');

  if (next.phone && !phoneIsGrounded(next.phone, briefing)) {
    delete next.phone;
    dropped.push('telefone');
  }

  if (next.partnerUrl && !urlIsGrounded(next.partnerUrl, briefing)) {
    delete next.partnerUrl;
    dropped.push('link externo');
  }

  if (next.amenities?.length) {
    // §24: comodidades só quando explicitamente fornecidas. "Café da manhã
    // incluso" é uma promessa comercial, não uma escolha editorial.
    const kept = next.amenities.filter((amenity) => isGrounded(amenity, briefing));
    if (kept.length !== next.amenities.length) dropped.push('comodidades não informadas');
    if (kept.length) next.amenities = kept;
    else delete next.amenities;
  }

  return { draft: next, dropped };
}
