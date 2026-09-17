import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';

import { useReminderDelivery } from '@/hooks/useNotifications';
import {
  BackendCapabilityError,
  BackendRequestError,
} from '@/repositories/backendCapabilities';

const mockDeliverDueReminders = jest.fn();

jest.mock('@/repositories', () => ({
  dataSource: {
    notifications: {
      deliverDueReminders: (...args: unknown[]) => mockDeliverDueReminders(...args),
    },
  },
}));

let mockSessionToken: string | undefined = 'token-1';
let mockUserId: string | null = 'user-1';

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({
    user: mockUserId ? { id: mockUserId } : null,
    session: mockSessionToken ? { accessToken: mockSessionToken } : null,
  }),
}));

function makeHarness() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { wrapper, invalidate };
}

beforeEach(() => {
  mockSessionToken = 'token-1';
  mockUserId = 'user-1';
  mockDeliverDueReminders.mockReset();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('a entrega acontece quando pode acontecer', () => {
  it('capacidade disponível: entrega e atualiza a Central', async () => {
    mockDeliverDueReminders.mockResolvedValue(2);
    const { wrapper, invalidate } = makeHarness();

    renderHook(() => useReminderDelivery(), { wrapper });

    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    expect(mockDeliverDueReminders).toHaveBeenCalledWith('user-1');
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('nada vencido: não invalida nada e não reclama', async () => {
    mockDeliverDueReminders.mockResolvedValue(0);
    const { wrapper, invalidate } = makeHarness();

    renderHook(() => useReminderDelivery(), { wrapper });

    await waitFor(() => expect(mockDeliverDueReminders).toHaveBeenCalled());
    expect(invalidate).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('sem usuário logado a RPC nem é chamada', async () => {
    // Não há identidade para entregar lembretes de ninguém, e a RPC recusaria
    // do outro lado de qualquer forma. Melhor não gastar a chamada.
    mockUserId = null;
    mockSessionToken = undefined;
    const { wrapper, invalidate } = makeHarness();

    renderHook(() => useReminderDelivery(), { wrapper });

    await waitFor(() => expect(invalidate).not.toHaveBeenCalled());
    expect(mockDeliverDueReminders).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe('falhas ESPERADAS não abrem o LogBox', () => {
  /*
   * O sintoma relatado no Android era `REMINDER_DELIVERY_FAILED {"kind":"Error"}`
   * a cada abertura. Nenhum dos dois casos abaixo é defeito, e um alarme que
   * toca sempre deixa de ser alarme. O que muda não é o silêncio — é o canal:
   * `console.log` é lido por quem procura e não interrompe quem não está
   * procurando. `LogBox.ignoreLogs` continua não sendo usado em lugar nenhum.
   */
  it('capacidade ausente (0010 não publicada) sai como diagnóstico, não como aviso', async () => {
    mockDeliverDueReminders.mockRejectedValue(
      new BackendCapabilityError('MISSING_NOTIFICATIONS', {
        code: 'PGRST202',
        message: 'missing expected reminder delivery function',
      }),
    );
    const { wrapper, invalidate } = makeHarness();

    renderHook(() => useReminderDelivery(), { wrapper });

    await waitFor(() =>
      expect(console.log).toHaveBeenCalledWith(
        'REMINDER_DELIVERY_SKIPPED',
        JSON.stringify({ reason: 'CAPABILITY_UNAVAILABLE', capability: 'MISSING_NOTIFICATIONS' }),
      ),
    );
    expect(console.warn).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('recusa de autorização (42501) é condição de sessão, não defeito', async () => {
    /*
     * A forma exata medida contra o projeto real: `deliver_due_reminders`
     * existe no servidor e responde
     *   { code: '42501', message: 'permission denied for function ...' }
     * como OBJETO SIMPLES. Era isso que virava `new Error(...)` — e o log só
     * conseguia dizer `{"kind":"Error"}`, sem nomear a causa.
     */
    mockDeliverDueReminders.mockRejectedValue(
      new BackendRequestError('permission denied for function deliver_due_reminders', {
        code: '42501',
        message: 'permission denied for function deliver_due_reminders',
        status: 401,
      }),
    );
    const { wrapper } = makeHarness();

    renderHook(() => useReminderDelivery(), { wrapper });

    await waitFor(() =>
      expect(console.log).toHaveBeenCalledWith(
        'REMINDER_DELIVERY_SKIPPED',
        JSON.stringify({ reason: 'NOT_AUTHORIZED', backendCode: '42501' }),
      ),
    );
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('a recusa de sessão libera uma nova tentativa quando o token muda', async () => {
    // Uma abertura em que o JWT ainda não estava anexado não pode condenar a
    // sessão inteira: os lembretes ficariam sem entrega até reiniciar o app.
    mockDeliverDueReminders.mockRejectedValue(
      new BackendRequestError('Sessão obrigatória.', { code: '42501' }),
    );
    const { wrapper } = makeHarness();

    const { rerender } = renderHook(() => useReminderDelivery(), { wrapper });
    await waitFor(() => expect(mockDeliverDueReminders).toHaveBeenCalledTimes(1));

    mockDeliverDueReminders.mockResolvedValue(1);
    mockSessionToken = 'token-2';
    rerender(undefined);

    await waitFor(() => expect(mockDeliverDueReminders).toHaveBeenCalledTimes(2));
  });

  it('capacidade ausente NÃO é repetida a cada renovação de token', async () => {
    mockDeliverDueReminders.mockRejectedValue(
      new BackendCapabilityError('MISSING_NOTIFICATIONS', { code: 'PGRST202' }),
    );
    const { wrapper } = makeHarness();

    const { rerender } = renderHook(() => useReminderDelivery(), { wrapper });
    await waitFor(() => expect(mockDeliverDueReminders).toHaveBeenCalledTimes(1));

    mockSessionToken = 'token-2';
    rerender(undefined);

    await waitFor(() => expect(mockDeliverDueReminders).toHaveBeenCalledTimes(1));
  });
});

describe('falhas INESPERADAS continuam reportadas', () => {
  it('um erro que não é capacidade nem autorização mantém o console.warn', async () => {
    mockDeliverDueReminders.mockRejectedValue(new TypeError('Network request failed'));
    const { wrapper } = makeHarness();

    renderHook(() => useReminderDelivery(), { wrapper });

    await waitFor(() =>
      expect(console.warn).toHaveBeenCalledWith(
        'REMINDER_DELIVERY_FAILED',
        JSON.stringify({ kind: 'TypeError', backendCode: null }),
      ),
    );
  });

  it('o aviso carrega o código do backend quando ele existe — nunca payload', async () => {
    mockDeliverDueReminders.mockRejectedValue(
      new BackendRequestError('deu ruim', { code: 'PGRST116', message: 'deu ruim' }),
    );
    const { wrapper } = makeHarness();

    renderHook(() => useReminderDelivery(), { wrapper });

    await waitFor(() =>
      expect(console.warn).toHaveBeenCalledWith(
        'REMINDER_DELIVERY_FAILED',
        JSON.stringify({ kind: 'BackendRequestError', backendCode: 'PGRST116' }),
      ),
    );
  });
});
