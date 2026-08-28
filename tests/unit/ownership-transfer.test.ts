import {
  canTransferOwnership,
  transferCandidates,
  transferWarning,
  type TripMember,
  type TripRole,
} from '@/domain/collaboration';
import { AccountDeletionBlockedError } from '@/repositories/auth';

/**
 * Transferência de propriedade e guarda de exclusão — lado do cliente (§50).
 *
 * Nada aqui autoriza nada. Quem recusa é `transfer_trip_ownership` (0014), e o
 * teste dela é `supabase/tests/ownership_transfer.test.sql`. O que estas
 * asserções protegem é o contrário: que a tela não OFEREÇA uma transferência
 * que o banco recusaria — oferecer é prometer, e a promessa quebrada aparece
 * como erro depois do toque.
 */

const member = (
  userId: string,
  role: TripRole,
  name?: string,
): TripMember => ({
  id: `m-${userId}`,
  tripId: 'trip-1',
  userId,
  role,
  name,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('quem pode transferir', () => {
  it.each([
    ['owner' as const, 2, true],
    ['editor' as const, 2, false],
    ['viewer' as const, 2, false],
    [undefined, 2, false],
  ])('papel %s com %i candidatos → %s', (role, candidatos, esperado) => {
    expect(canTransferOwnership(role, candidatos)).toBe(esperado);
  });

  it('viagem sem outros viajantes não oferece transferência', () => {
    // Não é uma regra de segurança: é que não existe destinatário. Um botão
    // que abre uma lista vazia diz "isto deveria funcionar" e não funciona.
    expect(canTransferOwnership('owner', 0)).toBe(false);
  });
});

describe('para quem se pode transferir', () => {
  const eu = 'u-owner';

  it('exclui o próprio proprietário da lista', () => {
    const lista = transferCandidates(
      [member(eu, 'owner', 'Alice'), member('u-b', 'editor', 'Bento')],
      eu,
    );
    expect(lista.map((m) => m.userId)).toEqual(['u-b']);
  });

  it('exclui qualquer outro owner, mesmo que não seja quem lê', () => {
    // Estado que a 0014 impede, mas que uma base antiga pode ter. A tela não
    // deve oferecer transferir para quem já é dono.
    const lista = transferCandidates(
      [member(eu, 'owner'), member('u-x', 'owner'), member('u-b', 'editor')],
      eu,
    );
    expect(lista.map((m) => m.userId)).toEqual(['u-b']);
  });

  it('inclui editor e viewer — os dois já aceitaram o convite', () => {
    const lista = transferCandidates(
      [member(eu, 'owner'), member('u-b', 'editor', 'Bento'), member('u-c', 'viewer', 'Célia')],
      eu,
    );
    expect(lista).toHaveLength(2);
    expect(lista.map((m) => m.role).sort()).toEqual(['editor', 'viewer']);
  });

  it('ordena por nome, para a lista não trocar de ordem entre aberturas', () => {
    // `trip_members` não garante ordem. Sem o sort, a mesma tela abriria com as
    // pessoas em posições diferentes — e transferir é uma ação em que a posição
    // de um item importa.
    const lista = transferCandidates(
      [
        member(eu, 'owner'),
        member('u-z', 'editor', 'Zoé'),
        member('u-a', 'viewer', 'Ana'),
        member('u-m', 'editor', 'Marina'),
      ],
      eu,
    );
    expect(lista.map((m) => m.name)).toEqual(['Ana', 'Marina', 'Zoé']);
  });

  it('quem não tem nome legível entra como "Viajante" e não some da lista', () => {
    // O perfil só é legível pelo próprio dono (0002). Sumir da lista deixaria a
    // viagem intransferível para essa pessoa por um motivo de exibição.
    const lista = transferCandidates([member(eu, 'owner'), member('u-b', 'editor')], eu);
    expect(lista).toHaveLength(1);
  });

  it('lista vazia quando só existe o proprietário', () => {
    expect(transferCandidates([member(eu, 'owner')], eu)).toEqual([]);
  });
});

describe('o aviso antes de confirmar', () => {
  const aviso = transferWarning('Bento');

  it('nomeia quem recebe', () => {
    expect(aviso).toContain('Bento');
  });

  it('diz que quem transfere continua na viagem, e como', () => {
    // A pergunta que a pessoa faz antes de tocar é "eu perco a viagem?". A
    // resposta é não — vira editor —, e ela precisa estar no aviso, não numa
    // descoberta depois.
    expect(aviso).toContain('editor');
  });

  it('diz que desfazer depende do outro lado', () => {
    expect(aviso).toMatch(/transferir de volta/);
  });
});

describe('recusa de exclusão de conta por propriedade', () => {
  it('uma viagem: nomeia a viagem e o caminho', () => {
    const erro = new AccountDeletionBlockedError([
      { tripId: 't1', destinationCity: 'Lisboa', otherMembers: 2 },
    ]);
    expect(erro.message).toContain('Lisboa');
    expect(erro.message).toContain('Transfira a propriedade');
    expect(erro.code).toBe('ownership-blocked');
  });

  it('várias viagens: diz quantas são e quais', () => {
    const erro = new AccountDeletionBlockedError([
      { tripId: 't1', destinationCity: 'Lisboa', otherMembers: 2 },
      { tripId: 't2', destinationCity: 'Tóquio', otherMembers: 1 },
    ]);
    expect(erro.message).toContain('2 viagens');
    expect(erro.message).toContain('Lisboa');
    expect(erro.message).toContain('Tóquio');
  });

  it('é um Error de verdade, para atravessar o catch das telas', () => {
    const erro = new AccountDeletionBlockedError([]);
    expect(erro).toBeInstanceOf(Error);
    expect(erro.name).toBe('AccountDeletionBlockedError');
  });

  it('carrega as viagens para a tela poder listá-las', () => {
    const erro = new AccountDeletionBlockedError([
      { tripId: 't1', destinationCity: 'Lisboa', otherMembers: 3 },
    ]);
    expect(erro.trips).toEqual([
      { tripId: 't1', destinationCity: 'Lisboa', otherMembers: 3 },
    ]);
  });
});
