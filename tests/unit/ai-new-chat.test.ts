import { jsonStorage } from '@/lib/storage';
import { localDataSource as source } from '@/repositories/local/LocalDataSource';

/**
 * "Novo chat" (§2).
 *
 * As conversas da IA são persistidas de verdade (`ai_conversations` /
 * `ai_messages`), então começar de novo não pode ser encenação: `clearConversation`
 * apagaria as mensagens da conversa que já existe, e o usuário perderia o
 * histórico sem ter pedido isso. `createConversation` é o caminho correto —
 * abre outra thread e deixa a anterior intacta.
 *
 * O outro contrato fixado aqui é o de reabertura: `getOrCreateConversation`
 * precisa devolver a conversa *mais recente*, ou voltar à tela cairia num chat
 * antigo depois de um "Novo chat".
 */

const USER = 'usuario-ia';
const PARIS = 'trip-paris';
const TOQUIO = 'trip-toquio';

beforeAll(async () => {
  await jsonStorage.clearAll();
});

describe('conversas da IA', () => {
  it('abre uma conversa nova sem apagar a anterior', async () => {
    const primeira = await source.ai.getOrCreateConversation(USER, PARIS);
    await source.ai.addMessage({
      conversationId: primeira.id,
      role: 'user',
      content: 'Quanto já gastei?',
    });

    const segunda = await source.ai.createConversation(USER, PARIS);

    expect(segunda.id).not.toBe(primeira.id);
    // A thread nova nasce vazia...
    expect(await source.ai.listMessages(segunda.id)).toHaveLength(0);
    // ...e o histórico anterior continua onde estava.
    expect(await source.ai.listMessages(primeira.id)).toHaveLength(1);
  });

  it('reabre na conversa mais recente da viagem', async () => {
    const conversas = await source.ai.listConversations(USER, PARIS);
    const maisRecente = [...conversas].sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1))[0];

    expect((await source.ai.getOrCreateConversation(USER, PARIS)).id).toBe(maisRecente.id);
  });

  it('mantém uma thread por viagem — trocar de viagem não mistura conversas', async () => {
    const paris = await source.ai.getOrCreateConversation(USER, PARIS);
    const toquio = await source.ai.getOrCreateConversation(USER, TOQUIO);

    expect(toquio.id).not.toBe(paris.id);
    expect(toquio.tripId).toBe(TOQUIO);

    await source.ai.addMessage({
      conversationId: toquio.id,
      role: 'user',
      content: 'O que fazer em Tóquio?',
    });

    // A pergunta de Tóquio não aparece na conversa de Paris, e vice-versa: é
    // isto que impede o contexto de uma viagem vazar para a outra.
    const mensagensParis = await source.ai.listMessages(paris.id);
    expect(mensagensParis.every((m) => !m.content.includes('Tóquio'))).toBe(true);
  });

  it('não confunde as conversas de contas diferentes', async () => {
    const outra = await source.ai.getOrCreateConversation('outro-usuario', PARIS);
    const minhas = await source.ai.listConversations(USER, PARIS);

    expect(minhas.map((c) => c.id)).not.toContain(outra.id);
  });

  it('limpar continua sendo uma ação distinta de começar de novo', async () => {
    const conversa = await source.ai.createConversation(USER, PARIS);
    await source.ai.addMessage({ conversationId: conversa.id, role: 'user', content: 'oi' });

    await source.ai.clearConversation(conversa.id);

    // `clear` apaga mensagens; `createConversation` preserva. São operações
    // diferentes de propósito — "Novo chat" usa a segunda.
    expect(await source.ai.listMessages(conversa.id)).toHaveLength(0);
    expect((await source.ai.listConversations(USER, PARIS)).map((c) => c.id)).toContain(
      conversa.id,
    );
  });
});
