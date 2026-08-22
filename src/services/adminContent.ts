/**
 * Geração assistida de conteúdo administrativo (§29, §30, §33).
 *
 * Não é um segundo sistema de IA: é o mesmo caminho que a Easy Trip IA já usa —
 * `postJson` com timeout e erros tipados, BFF guardando a `GEMINI_API_KEY`,
 * JWT do próprio administrador no `Authorization`. A única diferença é o
 * endpoint e o fato de a resposta vir estruturada em vez de texto corrido.
 *
 * O cliente nunca fala com o Gemini. Se falasse, a chave estaria no bundle — e
 * qualquer um poderia extraí-la de um APK (§30, §72).
 */

import {
  generatedArticleSchema,
  generatedPlaceDraftSchema,
  type GeneratedArticle,
  type GeneratedPlaceDraft,
} from '@/domain/schemas';
import { config } from '@/lib/config';
import { postJson, ServiceError } from './http';

export type GenerationKind = 'article' | 'place';

export interface AdminContentService {
  /** `unavailable` enquanto o BFF não estiver configurado — nunca "fake". */
  readonly kind: 'gemini' | 'unavailable';
  generateArticle(params: { briefing: string; accessToken?: string }): Promise<GeneratedArticle>;
  generatePlace(params: {
    briefing: string;
    type: 'hotel' | 'restaurant';
    accessToken?: string;
  }): Promise<GeneratedPlaceDraft>;
}

const UNCONFIGURED_MESSAGE =
  'Preenchimento com IA indisponível. Configure o serviço de IA para utilizar este recurso.';

async function generate<T>(
  kind: GenerationKind,
  payload: Record<string, unknown>,
  accessToken: string | undefined,
  parse: (value: unknown) => T,
): Promise<T> {
  const response = await postJson<{ data?: unknown; error?: string }>(
    `${config.bffUrl.replace(/\/$/, '')}/admin-generate-content`,
    { kind, ...payload },
    { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} },
  );

  if (!response.data) {
    throw new ServiceError('parse', response.error ?? 'A IA não retornou conteúdo.');
  }

  try {
    // A resposta do modelo não é confiável só porque veio do modelo (§28).
    // Mesmo com `responseSchema` no Gemini, quem decide o que entra no
    // formulário é este parse.
    return parse(response.data);
  } catch {
    throw new ServiceError(
      'parse',
      'Não foi possível interpretar a resposta da IA. Tente novamente.',
    );
  }
}

class RemoteAdminContentService implements AdminContentService {
  readonly kind = 'gemini' as const;

  generateArticle({ briefing, accessToken }: { briefing: string; accessToken?: string }) {
    return generate('article', { briefing }, accessToken, (value) =>
      generatedArticleSchema.parse(value),
    );
  }

  generatePlace({
    briefing,
    type,
    accessToken,
  }: {
    briefing: string;
    type: 'hotel' | 'restaurant';
    accessToken?: string;
  }) {
    return generate('place', { briefing, type }, accessToken, (value) =>
      generatedPlaceDraftSchema.parse(value),
    );
  }
}

/**
 * Sem BFF, a única resposta honesta é dizer que o recurso não está disponível.
 *
 * A alternativa — devolver um artigo de exemplo — seria pior do que não ter o
 * recurso: o administrador reveria e publicaria um texto achando que a IA o
 * escreveu a partir do briefing dele (§34).
 */
class UnavailableAdminContentService implements AdminContentService {
  readonly kind = 'unavailable' as const;

  private fail(): never {
    throw new ServiceError('unconfigured', UNCONFIGURED_MESSAGE);
  }

  async generateArticle(): Promise<GeneratedArticle> {
    this.fail();
  }

  async generatePlace(): Promise<GeneratedPlaceDraft> {
    this.fail();
  }
}

export const adminContentService: AdminContentService = config.hasBff
  ? new RemoteAdminContentService()
  : new UnavailableAdminContentService();

export { UNCONFIGURED_MESSAGE };
