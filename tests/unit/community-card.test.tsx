import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';

import { CommunityCard } from '@/components/cards/CommunityCard';
import { ToastProvider } from '@/components/ui';

// O toast se posiciona pela área segura, então ela precisa existir na árvore.
const metrics: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const INVITE = 'https://chat.whatsapp.com/AbCdEf123456';
const mockInvite = { url: INVITE };

jest.mock('@/constants/community', () => ({
  get WHATSAPP_COMMUNITY_URL() {
    return mockInvite.url;
  },
  isCommunityInviteConfigured: (url?: string) =>
    /^https:\/\/(chat\.whatsapp\.com|wa\.me)\/\S+$/.test((url ?? mockInvite.url).trim()),
}));

const mockOpenURL = jest.fn();
const mockOpenBrowser = jest.fn();
jest.mock('expo-linking', () => ({ openURL: (url: string) => mockOpenURL(url) }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: (url: string) => mockOpenBrowser(url) }));

const renderCard = () =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ToastProvider>
        <CommunityCard />
      </ToastProvider>
    </SafeAreaProvider>,
  );

const press = () =>
  fireEvent.press(screen.getByLabelText('Entrar na comunidade do Easy Trip no WhatsApp'));

beforeEach(() => {
  mockInvite.url = INVITE;
  mockOpenURL.mockReset().mockResolvedValue(true);
  mockOpenBrowser.mockReset().mockResolvedValue(undefined);
});

describe('CommunityCard', () => {
  it('invites without shouting', () => {
    renderCard();

    expect(screen.getByText('Comunidade Easy Trip')).toBeTruthy();
    expect(screen.getByText(/compartilha/i)).toBeTruthy();
    // O CTA nomeia a ação, em vez de um "Saiba mais" genérico (§6).
    expect(screen.getByText('Entrar na comunidade')).toBeTruthy();
  });

  it('names the destination for screen readers, not just the icon', () => {
    renderCard();
    expect(screen.getByLabelText('Entrar na comunidade do Easy Trip no WhatsApp')).toBeTruthy();
  });

  it('opens the invite', async () => {
    renderCard();
    press();

    await waitFor(() => expect(mockOpenURL).toHaveBeenCalledWith(INVITE));
    expect(mockOpenBrowser).not.toHaveBeenCalled();
  });

  it('falls back to the browser when nothing handles the link', async () => {
    mockOpenURL.mockRejectedValue(new Error('no activity found'));
    renderCard();
    press();

    await waitFor(() => expect(mockOpenBrowser).toHaveBeenCalledWith(INVITE));
  });

  it('says so instead of failing silently when the invite is not set', async () => {
    mockInvite.url = '';
    renderCard();
    press();

    await waitFor(() =>
      expect(screen.getByText('O convite da comunidade ainda não foi configurado.')).toBeTruthy(),
    );
    expect(mockOpenURL).not.toHaveBeenCalled();
    expect(mockOpenBrowser).not.toHaveBeenCalled();
  });

  it('reports a failure the user can act on when both routes fail', async () => {
    mockOpenURL.mockRejectedValue(new Error('boom'));
    mockOpenBrowser.mockRejectedValue(new Error('boom'));
    renderCard();
    press();

    await waitFor(() => expect(screen.getByText(/Não foi possível abrir a comunidade/)).toBeTruthy());
  });
});
