import { SuggestionGenerationError } from '@/domain/suggestions';
import { BackendCapabilityError } from '@/repositories/backendCapabilities';
import { shouldRetrySuggestions } from '@/hooks/useSuggestions';

jest.mock('@/repositories', () => ({ dataSource: { suggestions: {} } }));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: undefined }) }));

/**
 * O ESQUELETO QUE NÃO SAÍA DA TELA.
 *
 * `AppProviders` repete toda consulta até três vezes. Para `ensure` isso é
 * duplamente ruim: cada tentativa carrega o orçamento de 30 s do `postJson`,
 * então uma geração que falha deixava a tela em esqueleto por mais de um
 * minuto; e, pior, as tentativas 2 e 3 não tinham como dar certo — a janela de
 * seis horas foi consumida pela tentativa 1, antes do Gemini, então elas nem
 * chamavam a Function. O erro que sobrava no fim era o delas, não o da falha
 * real.
 */
describe('quando repetir `ensure` pode ajudar', () => {
  it('não repete um veredito de geração — ele já diz o que aconteceu', () => {
    const falha = new SuggestionGenerationError('INCOMPLETE_GENERATION', 'incompleta');
    expect(shouldRetrySuggestions(0, falha)).toBe(false);
  });

  it.each([
    'REFRESH_LIMITED',
    'PERMISSION_DENIED',
    'AI_UNAVAILABLE',
    'AI_PROVIDER_FAILED',
    'CATALOG_UNAVAILABLE',
  ] as const)('não repete %s', (code) => {
    expect(shouldRetrySuggestions(0, new SuggestionGenerationError(code, 'x'))).toBe(false);
  });

  it('não repete um backend incompatível — a 0012 não chega por insistência', () => {
    expect(shouldRetrySuggestions(0, new BackendCapabilityError('MISSING_SUGGESTIONS_SCHEMA'))).toBe(
      false,
    );
  });

  it('continua repetindo a leitura que simplesmente não chegou', () => {
    // Uma falha de transporte na leitura da coleção é transitória: a segunda
    // tentativa pega o que a primeira perdeu, e nada foi consumido.
    const rede = new Error('Network request failed');
    expect(shouldRetrySuggestions(0, rede)).toBe(true);
    expect(shouldRetrySuggestions(1, rede)).toBe(true);
    expect(shouldRetrySuggestions(2, rede)).toBe(false);
  });
});
