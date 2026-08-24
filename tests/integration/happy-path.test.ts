import { getRemainingBudget, getTripTotalSpent } from '@/domain/selectors';
import { localDataSource as db } from '@/repositories/local/LocalDataSource';

/**
 * O caminho inteiro de um usuário, do cadastro ao retorno (F10, §33).
 *
 * As outras suítes de integração cobrem uma regra cada. Esta cobre a **ordem**:
 * um usuário só chega ao diário porque antes criou a viagem, e só reencontra
 * tudo porque o que ele fez sobreviveu ao fechamento do aplicativo. Um conjunto
 * de testes que passa isoladamente e falha em sequência é um conjunto que não
 * mediu o produto — mediu funções.
 *
 * Roda contra o `LocalDataSource` real (AsyncStorage e sistema de arquivos em
 * memória), que é o mesmo caminho de código do modo demonstração. O equivalente
 * remoto — com JWT, RLS e Storage de verdade — são as sete baterias em
 * `supabase/tests/`.
 */

const A = 'user-happy-a';
const B = 'user-happy-b';

const fs = () => require('expo-file-system') as { __reset: () => void };

beforeAll(async () => {
  fs().__reset();
  await db.purgeUserData(A);
  await db.purgeUserData(B);
});

describe('caminho feliz completo', () => {
  it('percorre os quinze passos e reencontra tudo no fim', async () => {
    /* 1–2. Perfil. O cadastro em si é do adaptador de Auth; aqui começa no
       primeiro efeito dele: o perfil existe e é editável. */
    await db.profile.update(A, { name: 'Joana Ribeiro', homeCity: 'Belo Horizonte' });
    const perfil = await db.profile.get(A);
    expect(perfil?.name).toBe('Joana Ribeiro');

    /* 3–4. Viagem, que passa a ser a viagem corrente. */
    const viagem = await db.trips.create({
      userId: A,
      destinationCity: 'Lisboa',
      destinationCountry: 'Portugal',
      countryCode: 'PT',
      timezone: 'Europe/Lisbon',
      startDate: '2026-10-05',
      endDate: '2026-10-12',
      budgetTotal: 9000,
      budgetCurrency: 'BRL',
    });
    expect((await db.trips.list(A)).map((t) => t.id)).toContain(viagem.id);

    /* 5. Roteiro. */
    await db.itinerary.create({
      tripId: viagem.id,
      date: '2026-10-06',
      type: 'atracao',
      title: 'Mosteiro dos Jerónimos',
      startTime: '09:30',
      completed: false,
      sortOrder: 0,
    });

    /* 6. Checklist. */
    const item = await db.checklist.create({
      tripId: viagem.id,
      label: 'Passaporte',
      category: 'documentos',
      completed: false,
    });
    await db.checklist.update(item.id, { completed: true });

    /* 7. Despesa — e o orçamento reagindo a ela. */
    await db.expenses.create({
      tripId: viagem.id,
      userId: A,
      description: 'Jantar em Alfama',
      amount: 320,
      currency: 'BRL',
      category: 'alimentacao',
      transactionDate: '2026-10-06',
    });

    /* 8. Documento com arquivo. */
    const anexo = await db.travelReservations.uploadDocument(A, viagem.id, {
      uri: 'file:///cache/bilhete.pdf',
      name: 'bilhete.pdf',
      mimeType: 'application/pdf',
      size: 4096,
    });
    const reserva = await db.travelReservations.create({
      tripId: viagem.id,
      createdBy: A,
      type: 'flight',
      title: 'Voo GRU → LIS',
      status: 'confirmed',
      details: { flightNumber: 'TP1234' },
      fileUrl: anexo.url,
      mimeType: anexo.mimeType,
    });
    expect(reserva.fileUrl).toBeTruthy();

    /* 9. Diário com foto. */
    const registro = await db.journal.create({
      tripId: viagem.id,
      userId: A,
      entryDate: '2026-10-06',
      content: 'Primeiro pastel de nata da viagem.',
    });
    await db.journal.addMedia(registro.id, A, {
      uri: 'file:///cache/nata.jpg',
      name: 'nata.jpg',
      mimeType: 'image/jpeg',
      size: 2048,
    });

    /* 10. Meta. */
    const meta = await db.goals.create({
      userId: A,
      type: 'economia',
      title: 'Guardar para a próxima viagem',
      targetValue: 5000,
      currentValue: 0,
      unit: 'R$',
      status: 'active',
    });
    await db.goals.update(meta.id, { currentValue: 5000, status: 'completed' });

    /* 11. "Fechar e reabrir": as coleções são relidas do armazenamento, que é
       o que o aplicativo faz ao montar de novo. */
    const viagemDepois = await db.trips.get(viagem.id);
    expect(viagemDepois?.destinationCity).toBe('Lisboa');

    const despesas = await db.expenses.listByTrip(viagem.id);
    expect(getTripTotalSpent(despesas, viagemDepois!)).toBe(320);
    expect(getRemainingBudget(despesas, viagemDepois!)).toBe(8680);

    expect((await db.itinerary.listByTrip(viagem.id))).toHaveLength(1);
    expect((await db.checklist.listByTrip(viagem.id))[0].completed).toBe(true);
    expect((await db.travelReservations.listByTrip(viagem.id))).toHaveLength(1);
    expect((await db.journal.listMedia([registro.id]))).toHaveLength(1);
    expect((await db.goals.list(A))[0]).toMatchObject({ currentValue: 5000, status: 'completed' });

    /* 12. Conteúdo editorial publicado continua público e sem rascunho. */
    const artigos = await db.content.listArticles();
    expect(artigos.length).toBeGreaterThan(0);
    expect(artigos.every((a) => a.status === 'published')).toBe(true);

    /* 13–15. "Logout e login": nada do usuário A é derivado de sessão — o que
       prova o retorno é o dado continuar lá quando perguntado de novo por A, e
       continuar invisível para B. */
    expect((await db.trips.list(A)).map((t) => t.id)).toContain(viagem.id);
    expect(await db.profile.get(A)).toMatchObject({ name: 'Joana Ribeiro' });
  });

  it('não entrega nada do usuário A ao usuário B', async () => {
    const doB = await db.trips.list(B);
    expect(doB).toHaveLength(0);
    expect(await db.goals.list(B)).toHaveLength(0);
    expect(await db.insurance.listByUser(B)).toHaveLength(0);
    // O perfil de A não vaza pela consulta de B.
    expect(await db.profile.get(B)).toBeNull();
  });

  it('a exclusão da conta leva a árvore inteira, e só a dela', async () => {
    const viagemB = await db.trips.create({
      userId: B,
      destinationCity: 'Porto',
      destinationCountry: 'Portugal',
      countryCode: 'PT',
      timezone: 'Europe/Lisbon',
      startDate: '2026-11-01',
      endDate: '2026-11-05',
      budgetTotal: 4000,
      budgetCurrency: 'BRL',
    });

    await db.purgeUserData(A);

    expect(await db.trips.list(A)).toHaveLength(0);
    expect(await db.goals.list(A)).toHaveLength(0);
    expect(await db.profile.get(A)).toBeNull();
    // E o vizinho continua inteiro.
    expect((await db.trips.list(B)).map((t) => t.id)).toContain(viagemB.id);
  });
});
