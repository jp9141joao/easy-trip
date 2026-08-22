import { jsonStorage } from '@/lib/storage';
import { localDataSource as source } from '@/repositories/local/LocalDataSource';

/**
 * F7 — P-03.
 *
 * `Consultation.scheduledAt` e `ReservationRequest.requestedFor` diziam ser
 * `ISODateTime` e nunca foram: a coluna é `text` e a tela pede a preferência em
 * palavras ("quinta à tarde"). O tipo mentiroso não era só feio — a listagem de
 * consultas ordenava por esse campo, comparando frases como se fossem datas.
 */

/**
 * Um usuário por teste.
 *
 * `jsonStorage.clearAll()` não serve de isolamento aqui: a `LocalCollection`
 * guarda o cache em memória e não o relê do disco depois de carregado, então os
 * pedidos de um teste apareceriam na lista do seguinte. Como todas as consultas
 * são filtradas por `userId`, um id diferente por teste isola de verdade.
 */
let USUARIO = 'usuario-p03';
let contador = 0;

beforeEach(async () => {
  await jsonStorage.clearAll();
  contador += 1;
  USUARIO = `usuario-p03-${contador}`;
});

describe('o campo guarda texto de agenda, não data', () => {
  it('aceita e devolve intacto o que a pessoa escreveu', async () => {
    // São exatamente os exemplos que os `placeholder` das duas telas sugerem.
    for (const texto of ['quinta à tarde', '20/09 às 15h', 'qualquer dia da semana que vem']) {
      const pedido = await source.advisors.requestConsultation({
        userId: USUARIO,
        advisorId: 'especialista-1',
        scheduledAt: texto,
      });
      expect(pedido.scheduledAt).toBe(texto);
    }
  });

  it('o que a pessoa escreveu não é data — e nada no código finge que é', async () => {
    const pedido = await source.advisors.requestConsultation({
      userId: USUARIO,
      advisorId: 'especialista-1',
      scheduledAt: 'quinta à tarde',
    });

    // A prova de que o tipo antigo mentia: quem confiasse nele receberia isto.
    expect(Number.isNaN(new Date(pedido.scheduledAt).getTime())).toBe(true);

    // E a prova de que existe um instante de verdade ao lado, para quem
    // precisar de um.
    expect(Number.isNaN(new Date(pedido.createdAt).getTime())).toBe(false);
  });
});

describe('a lista de consultas se ordena por quando o pedido foi feito', () => {
  it('o mais recente vem primeiro, mesmo com textos que ordenariam ao contrário', async () => {
    // Escolhidos para que a ordem alfabética seja o **oposto** da cronológica:
    // "20/09..." < "amanhã..." < "quinta..." como string, e é essa comparação
    // que `listConsultations` fazia.
    const primeiro = await source.advisors.requestConsultation({
      userId: USUARIO,
      advisorId: 'a',
      scheduledAt: 'quinta à tarde',
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const segundo = await source.advisors.requestConsultation({
      userId: USUARIO,
      advisorId: 'b',
      scheduledAt: 'amanhã cedo',
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const terceiro = await source.advisors.requestConsultation({
      userId: USUARIO,
      advisorId: 'c',
      scheduledAt: '20/09 às 15h',
    });

    const lista = await source.advisors.listConsultations(USUARIO);
    expect(lista.map((c) => c.id)).toEqual([terceiro.id, segundo.id, primeiro.id]);

    // E a confirmação de que a ordem antiga era mesmo outra: ordenar pelo texto
    // devolveria o pedido mais antigo por último de um jeito diferente.
    const porTexto = [...lista].sort((a, b) => (a.scheduledAt < b.scheduledAt ? 1 : -1));
    expect(porTexto.map((c) => c.id)).not.toEqual(lista.map((c) => c.id));
  });

  it('cada pedido nasce com o instante em que foi feito', async () => {
    const antes = Date.now();
    const pedido = await source.advisors.requestConsultation({
      userId: USUARIO,
      advisorId: 'a',
      scheduledAt: 'sexta',
    });
    const carimbo = new Date(pedido.createdAt).getTime();

    expect(carimbo).toBeGreaterThanOrEqual(antes - 1000);
    expect(carimbo).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('a solicitação de reserva também guarda texto e se ordena pela criação', async () => {
    const pedido = await source.reservations.request({
      userId: USUARIO,
      placeId: 'lugar-1',
      placeName: 'Cantina',
      requestedFor: '20/09 às 20h',
      partySize: 2,
    });

    const lista = await source.reservations.listByUser(USUARIO);
    expect(lista[0].requestedFor).toBe('20/09 às 20h');
    expect(Number.isNaN(new Date(lista[0].createdAt).getTime())).toBe(false);
    expect(lista[0].id).toBe(pedido.id);
  });
});
