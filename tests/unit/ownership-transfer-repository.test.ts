import {
  createMembershipRepository,
  type CollaborationDeps,
} from '@/repositories/supabase/collaboration';

/**
 * O contrato entre o repositório e a função `transfer_trip_ownership` (0014).
 *
 * O que este arquivo protege é uma coisa só, e ela é fácil de quebrar numa
 * refatoração: a transferência tem de sair como UMA chamada de RPC. A
 * propriedade mora em `trips.user_id` e em `trip_members.role` — as duas pernas
 * de `is_trip_owner` (0008) —, e gravá-las daqui seriam duas requisições. Uma
 * falha de rede entre elas deixaria a viagem com dois donos ou com nenhum.
 */

type RpcCall = { fn: string; args: Record<string, unknown> };

function depsSpy(response: { data: unknown; error: unknown }) {
  const calls: RpcCall[] = [];
  const writes: string[] = [];

  const query: Record<string, unknown> = {};
  const chain = () => query;
  for (const method of ['select', 'eq', 'is', 'order', 'limit']) {
    query[method] = jest.fn(chain);
  }
  // Escrita direta em tabela é justamente o que NÃO pode acontecer aqui.
  for (const method of ['update', 'insert', 'upsert', 'delete']) {
    query[method] = jest.fn(() => {
      writes.push(method);
      return query;
    });
  }
  query.single = jest.fn(async () => ({ data: null, error: null }));
  query.maybeSingle = jest.fn(async () => ({ data: null, error: null }));
  query.then = (resolve: (v: unknown) => unknown, reject: (r: unknown) => unknown) =>
    Promise.resolve({ data: [], error: null }).then(resolve, reject);

  const client = {
    from: jest.fn(() => query),
    rpc: jest.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return response;
    }),
  };

  const deps: CollaborationDeps = {
    db: () => client as never,
    unwrap: (r: { data: unknown; error: unknown }) => r.data as never,
    unwrapList: (r: { data: unknown[] | null; error: unknown }) => (r.data ?? []) as never,
    prune: (row) => row,
    openableUrl: async () => undefined,
    uploadAttachment: async () => ({}) as never,
    attachmentsBucket: 'attachments',
  };

  return { deps, calls, writes };
}

const row = {
  id: 'm-1',
  trip_id: 'trip-1',
  user_id: 'u-b',
  role: 'owner',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
};

describe('transferOwnership', () => {
  it('chama o RPC transfer_trip_ownership com viagem e novo dono', () => {
    const { deps, calls } = depsSpy({ data: row, error: null });
    const repo = createMembershipRepository(deps);

    return repo.transferOwnership('trip-1', 'u-b').then(() => {
      const transfer = calls.filter((c) => c.fn === 'transfer_trip_ownership');
      expect(transfer).toHaveLength(1);
      expect(transfer[0].args).toEqual({ target_trip: 'trip-1', new_owner: 'u-b' });
    });
  });

  it('não escreve em tabela nenhuma — a atomicidade é do servidor', async () => {
    const { deps, calls, writes } = depsSpy({ data: row, error: null });
    const repo = createMembershipRepository(deps);

    await repo.transferOwnership('trip-1', 'u-b');

    expect(writes).toEqual([]);
    // E uma chamada só: duas requisições não são atômicas nem se as duas
    // forem RPC.
    expect(calls).toHaveLength(1);
  });

  it('devolve a linha do novo proprietário já traduzida', async () => {
    const { deps } = depsSpy({ data: row, error: null });
    const repo = createMembershipRepository(deps);

    const membro = await repo.transferOwnership('trip-1', 'u-b');

    expect(membro).toMatchObject({
      id: 'm-1',
      tripId: 'trip-1',
      userId: 'u-b',
      role: 'owner',
    });
  });

  it('a recusa do servidor chega à tela como mensagem legível', async () => {
    // A função levanta exceções escritas para o usuário final. O supabase-js as
    // embrulha com prefixo de RPC; a tela não pode mostrar o embrulho.
    const { deps } = depsSpy({
      data: null,
      error: {
        message:
          'transfer_trip_ownership: O novo proprietário precisa ser um viajante desta viagem que já aceitou o convite.',
      },
    });
    const repo = createMembershipRepository(deps);

    await expect(repo.transferOwnership('trip-1', 'u-x')).rejects.toThrow(
      /já aceitou o convite/,
    );
  });

  it('não engole a recusa: quem chama sempre recebe erro', async () => {
    const { deps } = depsSpy({
      data: null,
      error: { message: 'Apenas o proprietário pode transferir a viagem.' },
    });
    const repo = createMembershipRepository(deps);

    await expect(repo.transferOwnership('trip-1', 'u-b')).rejects.toBeInstanceOf(Error);
  });
});
