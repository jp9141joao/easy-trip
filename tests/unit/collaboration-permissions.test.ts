import {
  ROLE_LABEL,
  authorshipLabel,
  canEditTrip,
  canLeaveTrip,
  canManageMembers,
  isTripOwner,
  memberDisplayName,
  roleAccessibilityLabel,
  type TripRole,
} from '@/domain/collaboration';

/**
 * As permissões do lado do cliente (§1, §3, §50).
 *
 * Nada aqui é autorização — quem recusa é a RLS, e o teste dela é
 * `supabase/tests/rls_collaboration.test.sql`. O que estas asserções protegem é
 * a interface: um botão oferecido a quem vai receber "não autorizado" é um
 * defeito de produto, e a tabela abaixo é o contrato dele.
 */
describe('papéis e permissões', () => {
  const matriz: [TripRole | undefined, boolean, boolean, boolean][] = [
    // papel      canEdit  manageMembers  isOwner
    ['owner', true, true, true],
    ['editor', true, false, false],
    ['viewer', false, false, false],
    [undefined, false, false, false],
  ];

  it.each(matriz)('%s → editar:%s gerenciar:%s dono:%s', (role, edit, manage, owner) => {
    expect(canEditTrip(role)).toBe(edit);
    expect(canManageMembers(role)).toBe(manage);
    expect(isTripOwner(role)).toBe(owner);
  });

  it('editor não gerencia membros — é a diferença que define o papel', () => {
    expect(canEditTrip('editor')).toBe(true);
    expect(canManageMembers('editor')).toBe(false);
  });

  it('viewer não escreve nada', () => {
    expect(canEditTrip('viewer')).toBe(false);
  });
});

describe('sair da viagem (§50)', () => {
  it('colaborador pode sair a qualquer momento', () => {
    expect(canLeaveTrip('editor', 3)).toBe(true);
    expect(canLeaveTrip('viewer', 3)).toBe(true);
  });

  it('proprietário NÃO sai enquanto houver outra pessoa dentro', () => {
    expect(canLeaveTrip('owner', 2)).toBe(false);
    expect(canLeaveTrip('owner', 5)).toBe(false);
  });

  it('proprietário sozinho pode sair — não há ninguém para deixar sem dono', () => {
    expect(canLeaveTrip('owner', 1)).toBe(true);
  });

  it('quem não participa não sai', () => {
    expect(canLeaveTrip(undefined, 3)).toBe(false);
  });
});

describe('como um viajante aparece (§52, §70)', () => {
  it('a própria pessoa é "Você"', () => {
    expect(memberDisplayName({ userId: 'u1', name: 'Ana' }, 'u1')).toBe('Você');
  });

  it('sem nome legível, "Viajante" — nunca o e-mail', () => {
    const label = memberDisplayName({ userId: 'u2' }, 'u1');
    expect(label).toBe('Viajante');
    expect(label).not.toContain('@');
  });

  it('o rótulo de acessibilidade junta nome e papel, sem depender de cor', () => {
    expect(roleAccessibilityLabel('Maria', 'editor')).toBe(`Maria. ${ROLE_LABEL.editor}.`);
    expect(roleAccessibilityLabel('Maria', 'viewer')).toContain('Somente visualizar');
  });
});

describe('autoria discreta (§9)', () => {
  const nomes = { u1: 'Ana', u2: 'Bruno' };

  it('não anuncia o que a própria pessoa criou', () => {
    expect(authorshipLabel('u1', 'u1', nomes)).toBeUndefined();
  });

  it('anuncia quem criou quando é outra pessoa', () => {
    expect(authorshipLabel('u2', 'u1', nomes)).toBe('Adicionado por Bruno');
  });

  it('sem nome conhecido, não inventa rótulo', () => {
    expect(authorshipLabel('u9', 'u1', nomes)).toBeUndefined();
  });

  it('sem autor registrado, nada aparece', () => {
    expect(authorshipLabel(undefined, 'u1', nomes)).toBeUndefined();
  });
});
