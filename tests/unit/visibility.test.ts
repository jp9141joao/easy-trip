import {
  DEFAULT_VISIBILITY,
  VISIBILITY_LABEL,
  isVisibleTo,
  parseVisibility,
  visibilityAccessibilityLabel,
} from '@/domain/visibility';

/**
 * Os defaults de privacidade (§11) e a regra de leitura (§12).
 *
 * A regra é uma linha e não tem exceção:
 *
 *   membro E (shared OU created_by = eu)
 *
 * Sem bypass de proprietário. É a mesma condição da policy da 0009 — aqui ela
 * é testada para a fonte local, que não tem Postgres para aplicá-la.
 */
describe('defaults de criação (§11)', () => {
  it('roteiro, checklist e reservas nascem compartilhados', () => {
    expect(DEFAULT_VISIBILITY.itinerary).toBe('shared');
    expect(DEFAULT_VISIBILITY.checklist).toBe('shared');
    expect(DEFAULT_VISIBILITY.reservation).toBe('shared');
  });

  it('despesa e diário nascem PRIVADOS — o default conservador', () => {
    expect(DEFAULT_VISIBILITY.expense).toBe('private');
    expect(DEFAULT_VISIBILITY.journal).toBe('private');
  });

  it('nenhuma categoria escolhe "shared" por descuido: a lista é explícita', () => {
    // Se alguém acrescentar um escopo novo, este teste falha até que a decisão
    // de privacidade dele seja tomada de propósito.
    expect(Object.keys(DEFAULT_VISIBILITY).sort()).toEqual([
      'checklist',
      'expense',
      'itinerary',
      'journal',
      'reservation',
    ]);
  });
});

describe('quem vê o quê (§12)', () => {
  const compartilhado = { visibility: 'shared' as const, createdBy: 'ana' };
  const privadoDaAna = { visibility: 'private' as const, createdBy: 'ana' };

  it('compartilhado é visível para qualquer membro', () => {
    expect(isVisibleTo(compartilhado, 'bruno')).toBe(true);
    expect(isVisibleTo(compartilhado, 'ana')).toBe(true);
  });

  it('privado é visível só para quem criou', () => {
    expect(isVisibleTo(privadoDaAna, 'ana')).toBe(true);
    expect(isVisibleTo(privadoDaAna, 'bruno')).toBe(false);
  });

  it('não existe bypass de proprietário: dono da viagem também não lê privado alheio', () => {
    // "dono" aqui é qualquer outro id — a função não conhece papel, e é
    // justamente esse desconhecimento que garante a regra.
    expect(isVisibleTo(privadoDaAna, 'dono-da-viagem')).toBe(false);
  });

  it('sem sessão, privado não é visível nem por acidente', () => {
    expect(isVisibleTo(privadoDaAna, undefined)).toBe(false);
  });
});

describe('leitura defensiva e acessibilidade', () => {
  it('valor desconhecido cai no fallback declarado', () => {
    expect(parseVisibility('qualquer-coisa', 'private')).toBe('private');
    expect(parseVisibility(null, 'shared')).toBe('shared');
    expect(parseVisibility(undefined)).toBe('shared');
  });

  it('valor válido passa intacto', () => {
    expect(parseVisibility('private', 'shared')).toBe('private');
    expect(parseVisibility('shared', 'private')).toBe('shared');
  });

  it('§70: o estado tem texto próprio, não depende de ícone nem de cor', () => {
    expect(visibilityAccessibilityLabel('private')).toContain('somente você');
    expect(visibilityAccessibilityLabel('shared')).toContain('todos');
    expect(VISIBILITY_LABEL.private).toBe('Somente eu');
    expect(VISIBILITY_LABEL.shared).toBe('Todos da viagem');
  });
});
