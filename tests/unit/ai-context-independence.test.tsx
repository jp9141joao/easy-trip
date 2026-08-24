import { act, renderHook, waitFor } from '@testing-library/react-native';

import { clearAITripContext, readAITripContext, writeAITripContext } from '@/lib/aiTripContext';
import type { Trip } from '@/domain/types';
import { useAITripContext, type AITripContextValue } from '@/hooks/useAITripContext';
import { prefsStorage } from '@/lib/storage';

/**
 * A viagem da Home e a viagem da IA são duas seleções, não uma.
 *
 * O DEFEITO DE PRODUTO: escolher Paris na Home trocava por baixo o contexto de
 * uma conversa sobre Tóquio. A pessoa não pediu, não viu, e a resposta seguinte
 * saía com os dados da viagem errada — o pior tipo de erro de contexto, porque
 * a IA continua respondendo com confiança.
 *
 * A regra removida nesta rodada era "usar `currentTripId` como pré-seleção se
 * ele estiver na lista do usuário". Ela parecia uma conveniência inofensiva e
 * era o acoplamento inteiro.
 *
 * O que fica no lugar: uma preferência própria, por conta, validada contra a
 * lista real, e **sem fallback nenhum** para a seleção da Home.
 */

const trip = (id: string, city: string): Trip => ({
  id,
  userId: 'user-a',
  destinationCity: city,
  destinationCountry: 'País',
  countryCode: 'XX',
  timezone: 'UTC',
  startDate: '2026-08-22',
  endDate: '2026-08-31',
  budgetTotal: 1000,
  budgetCurrency: 'BRL',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const paris = trip('trip-paris', 'Paris');
const toquio = trip('trip-toquio', 'Tóquio');
const roma = trip('trip-roma', 'Roma');
const TRIPS = [paris, toquio, roma];

interface Props {
  id: string | null;
  list: Trip[];
}

const montar = (userId: string | null, trips: Trip[] = TRIPS, carregou = true) =>
  renderHook<AITripContextValue, Props>(
    ({ id, list }) => useAITripContext(id, list, carregou),
    { initialProps: { id: userId, list: trips } },
  );

beforeEach(async () => {
  await prefsStorage.remove('aiTripContextId:user-a');
  await prefsStorage.remove('aiTripContextId:user-b');
  await prefsStorage.remove('currentTripId');
});

describe('A. armazenamento separado', () => {
  it('a chave da IA é por conta, e não é a da Home', async () => {
    await writeAITripContext('user-a', 'trip-toquio');

    expect(await readAITripContext('user-a')).toBe('trip-toquio');
    // A viagem ativa da Home continua onde estava, intocada.
    expect(await prefsStorage.get('currentTripId', null)).toBeNull();
    // E a conta seguinte a entrar neste aparelho não herda nada (P-06).
    expect(await readAITripContext('user-b')).toBeNull();
  });

  it('a saída da conta apaga o contexto guardado', async () => {
    await writeAITripContext('user-a', 'trip-paris');
    await clearAITripContext('user-a');
    expect(await readAITripContext('user-a')).toBeNull();
  });
});

describe('B. as duas seleções não se tocam', () => {
  it('Home = Paris, IA = Tóquio; trocar a Home para Roma não move a IA', async () => {
    // A Home guarda a dela.
    await prefsStorage.set('currentTripId', 'trip-paris');
    await writeAITripContext('user-a', 'trip-toquio');

    const view = montar('user-a');
    await waitFor(() => expect(view.result.current.tripId).toBe('trip-toquio'));

    // A Home muda para Roma — é a única coisa que acontece.
    await act(async () => {
      await prefsStorage.set('currentTripId', 'trip-roma');
      view.rerender({ id: 'user-a', list: TRIPS });
    });

    expect(view.result.current.tripId).toBe('trip-toquio');
  });

  it('trocar a viagem da IA não mexe na viagem da Home', async () => {
    await prefsStorage.set('currentTripId', 'trip-roma');
    const view = montar('user-a');
    await waitFor(() => expect(view.result.current.restoring).toBe(false));

    act(() => {
      view.result.current.select('trip-paris');
    });

    await waitFor(() => expect(view.result.current.tripId).toBe('trip-paris'));
    expect(await prefsStorage.get('currentTripId', null)).toBe('trip-roma');
  });

  it('sem escolha própria, a IA abre sem contexto — nem com a Home apontando', async () => {
    // O fallback removido: `currentTripId` existe, é válido, é do usuário, e
    // mesmo assim não vira contexto da IA. A tela pede uma escolha, que é uma
    // pergunta honesta; adivinhar seria responder sobre a viagem errada.
    await prefsStorage.set('currentTripId', 'trip-paris');

    const view = montar('user-a');
    await waitFor(() => expect(view.result.current.restoring).toBe(false));

    expect(view.result.current.tripId).toBeNull();
  });
});

describe('C. o que é restaurado, e o que não é', () => {
  it('restaura a escolha anterior da própria IA', async () => {
    await writeAITripContext('user-a', 'trip-roma');
    const view = montar('user-a');
    await waitFor(() => expect(view.result.current.tripId).toBe('trip-roma'));
  });

  it('a escolha sobrevive a fechar e reabrir', async () => {
    const primeiro = montar('user-a');
    await waitFor(() => expect(primeiro.result.current.restoring).toBe(false));
    act(() => primeiro.result.current.select('trip-toquio'));
    await waitFor(() => expect(primeiro.result.current.tripId).toBe('trip-toquio'));
    primeiro.unmount();

    const segundo = montar('user-a');
    await waitFor(() => expect(segundo.result.current.tripId).toBe('trip-toquio'));
  });

  it('uma viagem que não existe mais não vira contexto', async () => {
    // Viagem excluída, ou de outra conta: a referência órfã sai e a tela volta
    // ao estado "selecione uma viagem".
    await writeAITripContext('user-a', 'trip-apagada');

    const view = montar('user-a');
    await waitFor(() => expect(view.result.current.restoring).toBe(false));
    await waitFor(() => expect(view.result.current.tripId).toBeNull());
    // E a preferência órfã é apagada, para não voltar a ser tentada.
    expect(await readAITripContext('user-a')).toBeNull();
  });

  it('não derruba a seleção enquanto a lista ainda não chegou', async () => {
    // Antes de a lista carregar, "não está na lista" significa "a lista ainda
    // não veio". Validar aqui apagaria o contexto a cada abertura.
    await writeAITripContext('user-a', 'trip-paris');

    const view = renderHook<AITripContextValue, { carregou: boolean }>(
      ({ carregou }) => useAITripContext('user-a', [], carregou),
      { initialProps: { carregou: false } },
    );

    await waitFor(() => expect(view.result.current.tripId).toBe('trip-paris'));
  });
});

describe('D. troca de conta', () => {
  it('o contexto do USER_A não aparece na sessão do USER_B', async () => {
    await writeAITripContext('user-a', 'trip-toquio');
    const view = montar('user-a');
    await waitFor(() => expect(view.result.current.tripId).toBe('trip-toquio'));

    await act(async () => {
      view.rerender({ id: 'user-b', list: TRIPS });
    });

    // Zerado antes mesmo de qualquer leitura do disco: nem por um quadro o
    // USER_B vê a viagem que o USER_A escolheu.
    await waitFor(() => expect(view.result.current.restoring).toBe(false));
    expect(view.result.current.tripId).toBeNull();
  });

  it('sair da conta zera o contexto em memória', async () => {
    await writeAITripContext('user-a', 'trip-paris');
    const view = montar('user-a');
    await waitFor(() => expect(view.result.current.tripId).toBe('trip-paris'));

    await act(async () => {
      view.rerender({ id: null, list: TRIPS });
    });

    expect(view.result.current.tripId).toBeNull();
  });
});
