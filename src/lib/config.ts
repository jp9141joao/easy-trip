/**
 * Runtime configuration (§17).
 *
 * Only `EXPO_PUBLIC_*` values ever reach the bundle. Secrets
 * (GEMINI_API_KEY, service role, weather/currency private keys) live exclusively
 * on the BFF — see `supabase/functions/`.
 */

/**
 * A barra final sai na leitura, e não em cada uso.
 *
 * `https://projeto.supabase.co/` e `https://projeto.supabase.co` são o mesmo
 * projeto, e quem copia a variável do painel leva a barra junto. Normalizar
 * uma vez aqui é o que permite comparar e concatenar sem repetir o mesmo
 * `replace` em todo chamador.
 */
const url = (process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? '').replace(/[/]+$/, '');
const rawAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? '';
const rawBffUrl = (process.env.EXPO_PUBLIC_BFF_URL?.trim() ?? '').replace(/[/]+$/, '');

/**
 * A chave que veio é uma chave **secreta**? (F10)
 *
 * As duas se parecem no dashboard e ficam lado a lado. Colar a errada aqui não
 * quebra nada visível: o aplicativo funciona, entra em modo produção e roda
 * normalmente — com a Row Level Security **desligada para todo mundo**, porque
 * `service_role` a ignora por definição. Qualquer pessoa com o APK passaria a
 * ler o banco inteiro. É a pior falha possível deste arquivo e a mais fácil de
 * cometer, então ela é detectada aqui.
 *
 * Duas formas: o formato atual (`sb_secret_…`) e o legado (JWT cujo payload traz
 * `"role":"service_role"`). O JWT é lido sem verificar assinatura de propósito —
 * o que interessa é o que ele **afirma** ser, não se é válido.
 */
function isSecretKey(value: string): boolean {
  if (value.startsWith('sb_secret_')) return true;
  const parts = value.split('.');
  if (parts.length !== 3) return false;
  try {
    // `atob` existe no Hermes e no Node; o payload é base64url.
    const payload = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(payload).role === 'service_role';
  } catch {
    return false;
  }
}

const anonKeyIsSecret = Boolean(rawAnonKey) && isSecretKey(rawAnonKey);

/**
 * Uma chave secreta é **descartada**, não usada com um aviso.
 *
 * Usá-la deixaria o aplicativo funcionando com o banco exposto; ignorá-la faz o
 * aplicativo cair em modo demonstração, que a tela de Ajustes já anuncia. Entre
 * "funciona e vaza" e "não conecta e diz por quê", a segunda é a única aceitável.
 */
const anonKey = anonKeyIsSecret ? '' : rawAnonKey;

/**
 * True when a real backend is wired up. When false the app runs on the local
 * adapter (`LocalDataSource`) — still fully persistent, but device-only, and
 * labelled as such in the UI. It never pretends a remote call happened.
 */
export const hasSupabase = Boolean(url && anonKey);

/**
 * AS EDGE FUNCTIONS SÃO DO MESMO PROJETO — E ISSO NÃO PRECISA SER DIGITADO.
 *
 * O sintoma que trouxe esta função: com Supabase configurado e
 * `EXPO_PUBLIC_BFF_URL` em branco, o aplicativo conectava no banco,
 * autenticava e sincronizava — e o assistente respondia LOCALMENTE, com o
 * rótulo de modo demonstração, num aplicativo que não estava em modo
 * demonstração nenhum. Quem lia "Resposta gerada localmente" não tinha como
 * saber que faltava uma TERCEIRA variável, justamente porque as outras duas
 * estavam certas.
 *
 * Num projeto hospedado as Functions vivem num endereço fixo, derivado do
 * próprio projeto: `<url do projeto>/functions/v1`. Não há o que adivinhar, e
 * pedir que alguém repita o mesmo `<ref>` numa segunda variável só cria mais
 * uma forma silenciosa de errar.
 *
 * O que NÃO é deduzido, de propósito:
 *
 *  - Instância própria ou domínio na frente das Functions. Ali o endereço é
 *    escolha de quem hospedou, e chutar mandaria a requisição — com o JWT do
 *    usuário — para um host que talvez não seja nosso. Nesse caso
 *    `configIssues` PEDE a variável em vez de inventar o valor.
 *  - Projeto sem chave pública utilizável. A Function autentica pelo JWT da
 *    sessão; sem cliente Supabase não há sessão, e deduzir a URL trocaria um
 *    modo honesto por um 401.
 *
 * `EXPO_PUBLIC_BFF_URL`, quando definida, continua vencendo: é ela que atende
 * `supabase functions serve` durante o desenvolvimento.
 */
const HOSTED_SUPABASE_HOST = /^https:[/][/][a-z0-9-]+[.]supabase[.](co|in)$/i;

export function deriveFunctionsUrl(supabaseUrl: string): string {
  const normalized = supabaseUrl.trim().replace(/[/]+$/, '');
  return HOSTED_SUPABASE_HOST.test(normalized) ? `${normalized}/functions/v1` : '';
}

const derivedBffUrl = hasSupabase ? deriveFunctionsUrl(url) : '';
const bffUrl = rawBffUrl || derivedBffUrl;

/**
 * De onde veio a URL do BFF — `env`, deduzida do projeto, ou nenhuma.
 *
 * Separa as três situações que antes chegavam à tela como uma só: "a IA está
 * respondendo localmente".
 */
export const bffSource: 'env' | 'derived' | 'none' = rawBffUrl
  ? 'env'
  : derivedBffUrl
    ? 'derived'
    : 'none';

/** True when the BFF is reachable — gates AI, weather and FX. */
export const hasBff = Boolean(bffUrl);

/**
 * POR QUE O ASSISTENTE ESTÁ NO MODO EM QUE ESTÁ.
 *
 * Existe para que nenhuma tela precise deduzir isso de dois booleanos — foi a
 * dedução ausente que fez "backend não configurado" e "backend configurado, IA
 * inalcançável" mostrarem exatamente o mesmo texto de modo demonstração.
 *
 *  - `backend`     → Gemini pela Edge Function. O caminho normal.
 *  - `demo`        → nada configurado. Modo demonstração legítimo, e a
 *                    resposta local é a resposta certa.
 *  - `unreachable` → Supabase configurado e endereço das Functions
 *                    desconhecido. Isto é INSTALAÇÃO PELA METADE, não
 *                    demonstração, e a tela precisa dizer a diferença.
 */
export type AIBackendState = 'backend' | 'demo' | 'unreachable';

export const aiBackendState: AIBackendState = hasBff
  ? 'backend'
  : hasSupabase
    ? 'unreachable'
    : 'demo';

/**
 * Problemas de configuração que o operador precisa ver — não o usuário final.
 *
 * A lista existe porque o modo demonstração tem duas causas muito diferentes:
 * "ninguém configurou nada" (esperado, e a tela já explica) e "alguém
 * configurou pela metade ou colou a chave errada" (um erro que, sem isto,
 * apareceria como um aplicativo silenciosamente offline). A tela de Ajustes
 * mostra a lista quando ela não está vazia.
 *
 * Configuração **opcional** não entra aqui: BFF, WhatsApp e convite da
 * comunidade ausentes desabilitam a própria funcionalidade, com texto próprio,
 * e não são defeito de instalação.
 */
export const configIssues: readonly string[] = [
  anonKeyIsSecret
    ? 'EXPO_PUBLIC_SUPABASE_ANON_KEY contém uma chave SECRETA (service_role). Ela foi ignorada: publicá-la no aplicativo desliga a segurança do banco. Use a chave pública (anon/publishable).'
    : null,
  url && !anonKey && !anonKeyIsSecret
    ? 'EXPO_PUBLIC_SUPABASE_URL foi definida, mas EXPO_PUBLIC_SUPABASE_ANON_KEY não. O aplicativo continua em modo demonstração.'
    : null,
  !url && rawAnonKey
    ? 'EXPO_PUBLIC_SUPABASE_ANON_KEY foi definida, mas EXPO_PUBLIC_SUPABASE_URL não. O aplicativo continua em modo demonstração.'
    : null,
  /*
   * Backend ligado com Functions inalcançáveis É defeito de instalação.
   *
   * A regra acima — configuração opcional não entra aqui — continua valendo
   * para quem não configurou nada. O caso desta linha é o oposto: o
   * aplicativo está conectado, a URL do projeto não tem a forma hospedada, e
   * por isso o endereço das Functions não pôde ser deduzido. O assistente cai
   * para a resposta local dentro de um aplicativo em produção, e sem esta
   * linha o único sinal disso seria a frase "gerada localmente" no meio de
   * uma conversa.
   */
  hasSupabase && !bffUrl
    ? 'EXPO_PUBLIC_SUPABASE_URL não tem a forma de um projeto hospedado (https://<ref>.supabase.co), então o endereço das Edge Functions não pôde ser deduzido. Defina EXPO_PUBLIC_BFF_URL: sem ele o assistente de IA, as sugestões de viagem e o preenchimento por IA do painel ficam indisponíveis.'
    : null,
].filter((issue): issue is string => issue !== null);

export const config = {
  supabaseUrl: url,
  supabaseAnonKey: anonKey,
  bffUrl,
  hasSupabase,
  hasBff,
  /** Operating mode, surfaced honestly in Settings and the AI screen. */
  mode: (hasSupabase ? 'production' : 'demo') as 'production' | 'demo',
} as const;

export type AppMode = typeof config.mode;
