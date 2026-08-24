import { jsonStorage } from '@/lib/storage';
import { localDataSource as source } from '@/repositories/local/LocalDataSource';

/**
 * As operações de conversa no repositório (§2).
 *
 * As conversas da IA são persistidas de verdade (`ai_conversations` /
 * `ai_messages`), e o repositório oferece três verbos que **não** são
 * sinônimos:
 *
 *   `createConversation` — abre outra thread, sem tocar nas anteriores;
 *   `clearConversation`  — apaga as mensagens, mantendo a conversa;
 *   `deleteConversation` — apaga a conversa **e** as mensagens dela.
 *
 * O "Novo chat" da tela usa `delete` + `create`, nesta ordem, desde a decisão
 * de produto de não manter histórico de conversas com a IA (ver
 * `ai-conversation-hook.test.tsx`). Os três continuam existindo porque são
 * contratos distintos, e é aqui que cada um é fixado.
 *
 * O outro contrato: `getOrCreateConversation` precisa devolver a conversa
 * *mais recente*, ou voltar à tela cairia num chat antigo.
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

  it('apagar a conversa leva as mensagens junto', async () => {
    // No Supabase quem faz isso é o `on delete cascade` de
    // `ai_messages.conversation_id` (0001). No modo local, a implementação
    // apaga as mensagens primeiro — para que uma falha no meio nunca deixe
    // mensagem órfã apontando para conversa inexistente.
    const conversa = await source.ai.createConversation(USER, PARIS);
    await source.ai.addMessage({ conversationId: conversa.id, role: 'user', content: 'pergunta' });
    await source.ai.addMessage({ conversationId: conversa.id, role: 'assistant', content: 'resposta' });

    await source.ai.deleteConversation(conversa.id);

    expect(await source.ai.listMessages(conversa.id)).toHaveLength(0);
    expect((await source.ai.listConversations(USER, PARIS)).map((c) => c.id)).not.toContain(
      conversa.id,
    );
  });

  it('apagar uma conversa não toca nas outras', async () => {
    const alvo = await source.ai.createConversation(USER, PARIS);
    const vizinha = await source.ai.createConversation(USER, TOQUIO);
    await source.ai.addMessage({ conversationId: alvo.id, role: 'user', content: 'de Paris' });
    await source.ai.addMessage({ conversationId: vizinha.id, role: 'user', content: 'de Tóquio' });

    await source.ai.deleteConversation(alvo.id);

    expect(await source.ai.listMessages(vizinha.id)).toHaveLength(1);
  });

  it('o histórico apagado não volta — nem numa leitura nova', async () => {
    // O equivalente a fechar e reabrir o aplicativo: `getOrCreate` procura a
    // conversa mais recente da viagem. Se a apagada tivesse sobrevivido em
    // algum lugar, ela reapareceria aqui.
    const apagada = await source.ai.createConversation(USER, PARIS);
    await source.ai.addMessage({ conversationId: apagada.id, role: 'user', content: 'já era' });
    await source.ai.deleteConversation(apagada.id);
    const nova = await source.ai.createConversation(USER, PARIS);

    const reaberta = await source.ai.getOrCreateConversation(USER, PARIS);
    expect(reaberta.id).toBe(nova.id);
    expect(await source.ai.listMessages(reaberta.id)).toHaveLength(0);
  });

  it('apagar uma conversa que já não existe não quebra', async () => {
    await expect(source.ai.deleteConversation('conversa-inexistente')).resolves.toBeUndefined();
  });
});
