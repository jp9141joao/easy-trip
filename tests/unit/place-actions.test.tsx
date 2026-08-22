import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';

import PlaceDetailScreen from '@/app/places/[placeId]';
import { ToastProvider } from '@/components/ui';
import type { Place } from '@/domain/types';
import { ThemeProvider } from '@/theme';

/**
 * As duas ações na tela de detalhes (§60, §61, §62).
 *
 * Os testes anteriores cobrem as funções puras; este cobre a fiação — que o
 * botão certo aparece, com o rótulo certo, e abre o que deveria abrir. É o
 * único que pega o caso em que a regra existe e ninguém a chamou.
 */

const metrics: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const mockPlace: { current: Place } = {
  current: {
    id: 'p1',
    name: 'Hotel Lumière Rivoli',
    type: 'hotel',
    city: 'Paris',
    country: 'França',
    partnerUrl: 'https://hotellumiere.fr',
  },
};

const mockOpenURL = jest.fn();
const mockOpenBrowser = jest.fn();

jest.mock('expo-linking', () => ({ openURL: (url: string) => mockOpenURL(url) }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: (url: string) => mockOpenBrowser(url) }));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ placeId: 'p1' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true }),
}));

jest.mock('@/constants/contact', () => {
  const actual = jest.requireActual('@/constants/contact');
  return {
    ...actual,
    EASYTRIP_CONTACT_WHATSAPP: '5511987654321',
    isContactWhatsappConfigured: (value?: string) =>
      actual.isContactWhatsappConfigured(value ?? '5511987654321'),
    buildWhatsappUrl: (message: string) => actual.buildWhatsappUrl(message, '5511987654321'),
  };
});

jest.mock('@/hooks/useContent', () => ({
  usePlace: () => ({ data: mockPlace.current, isLoading: false, isError: false, refetch: jest.fn() }),
  usePlaceFavorites: () => ({ isFavorite: () => false, toggle: { mutate: jest.fn() } }),
  useReservations: () => ({ request: { mutateAsync: jest.fn(), isPending: false } }),
}));
jest.mock('@/hooks/useTrips', () => ({ useCurrentTrip: () => ({ trip: null }) }));
jest.mock('@/services/ai', () => ({ aiService: { kind: 'local', send: jest.fn() } }));

const renderScreen = async () => {
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <ToastProvider>
          <PlaceDetailScreen />
        </ToastProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );
  await act(async () => undefined);
};

beforeEach(() => {
  mockOpenURL.mockReset();
  mockOpenBrowser.mockReset();
  mockPlace.current = {
    id: 'p1',
    name: 'Hotel Lumière Rivoli',
    type: 'hotel',
    city: 'Paris',
    country: 'França',
    partnerUrl: 'https://hotellumiere.fr',
  };
});

describe('hotel', () => {
  it('offers the hotel wording and opens WhatsApp with the message filled in', async () => {
    await renderScreen();

    fireEvent.press(screen.getByLabelText('Falar sobre este hotel pelo WhatsApp'));

    expect(mockOpenURL).toHaveBeenCalledTimes(1);
    const url = mockOpenURL.mock.calls[0][0] as string;
    expect(url.startsWith('https://wa.me/5511987654321?text=')).toBe(true);

    const message = decodeURIComponent(url.split('?text=')[1]);
    expect(message).toContain('Hotel Lumière Rivoli');
    expect(message).toContain('hospedagem');
  });

  it('falls back to the browser when no WhatsApp app handles the link (§7)', async () => {
    mockOpenURL.mockRejectedValueOnce(new Error('no handler'));
    await renderScreen();

    fireEvent.press(screen.getByLabelText('Falar sobre este hotel pelo WhatsApp'));
    await act(async () => undefined);

    expect(mockOpenBrowser).toHaveBeenCalledWith(expect.stringContaining('https://wa.me/'));
  });
});

describe('restaurant', () => {
  it('uses the restaurant wording, not the hotel one (§61)', async () => {
    mockPlace.current = { ...mockPlace.current, type: 'restaurant', name: 'Chez Marie' };
    await renderScreen();

    expect(screen.getByLabelText('Falar sobre este restaurante pelo WhatsApp')).toBeTruthy();
    expect(screen.queryByLabelText('Falar sobre este hotel pelo WhatsApp')).toBeNull();

    fireEvent.press(screen.getByLabelText('Falar sobre este restaurante pelo WhatsApp'));
    const message = decodeURIComponent(
      (mockOpenURL.mock.calls[0][0] as string).split('?text=')[1],
    );
    expect(message).toContain('Chez Marie');
    expect(message.toLowerCase()).not.toContain('hospedagem');
  });
});

describe('external link', () => {
  it('opens the registered url and labels it by destination (§62)', async () => {
    await renderScreen();

    fireEvent.press(screen.getByText('Ver site'));
    expect(mockOpenBrowser).toHaveBeenCalledWith('https://hotellumiere.fr/');
  });

  it('says "Ver no Google" when the link points at Google', async () => {
    mockPlace.current = {
      ...mockPlace.current,
      partnerUrl: 'https://www.google.com/maps/place/Hotel',
    };
    await renderScreen();

    expect(screen.getByText('Ver no Google')).toBeTruthy();
    expect(screen.queryByText('Ver site')).toBeNull();
  });

  it('hides the button entirely when there is no link (§12)', async () => {
    mockPlace.current = { ...mockPlace.current, partnerUrl: undefined };
    await renderScreen();

    expect(screen.queryByText('Ver site')).toBeNull();
    expect(screen.queryByText('Ver no Google')).toBeNull();
    // A outra ação continua lá — a ausência de link não afeta o WhatsApp.
    expect(screen.getByLabelText('Falar sobre este hotel pelo WhatsApp')).toBeTruthy();
  });

  it('hides the button when the registered link is not a web address (§11)', async () => {
    mockPlace.current = { ...mockPlace.current, partnerUrl: 'javascript:alert(1)' };
    await renderScreen();

    expect(screen.queryByText('Ver site')).toBeNull();
  });
});

describe('attraction', () => {
  it('has no commercial action, since there is no desk to talk to', async () => {
    mockPlace.current = { ...mockPlace.current, type: 'attraction', name: 'Torre Eiffel' };
    await renderScreen();

    expect(screen.queryByLabelText(/Falar sobre este/)).toBeNull();
    // O link externo é independente do tipo e continua disponível.
    expect(screen.getByText('Ver site')).toBeTruthy();
  });
});
