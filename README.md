# Easy Trip 2.0

Plataforma de gerenciamento de viagens em **React Native + Expo + TypeScript**,
executável diretamente no **Expo Go** — sem development build, sem `prebuild`,
sem `eject`.

O produto centraliza numa única viagem tudo o que normalmente fica espalhado
entre planilhas, e-mails, PDFs e notas: roteiro, checklist, diário, orçamento,
despesas, documentos, metas, clima, fuso horário, mapa, contatos de emergência,
consultoria humana e um assistente contextual.

---

## Sumário

- [Requisitos](#requisitos)
- [Instalação](#instalação)
- [Rodando no Expo Go](#rodando-no-expo-go)
- [Modos de operação](#modos-de-operação)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Backend (Supabase)](#backend-supabase)
- [Integrações reais](#integrações-reais)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Arquitetura](#arquitetura)
- [Testes](#testes)
- [Decisões de compatibilidade com Expo Go](#decisões-de-compatibilidade-com-expo-go)

---

## Requisitos

| Ferramenta | Versão |
| --- | --- |
| Node.js | 20+ (desenvolvido em 24.x) |
| npm | 10+ |
| Expo SDK | 57 |
| React Native | 0.86 |
| React | 19.2 |
| TypeScript | 6.x (modo `strict`) |
| Expo Go | versão compatível com SDK 57 |

---

## Instalação

```bash
npm install
cp .env.example .env    # opcional — veja "Modos de operação"
npx expo start
```

---

## Rodando no Expo Go

1. `npx expo start`
2. Instale o **Expo Go** no celular (Android ou iOS).
3. Escaneie o QR Code exibido no terminal.

O aplicativo abre direto. Nenhuma dependência exige módulo nativo fora do que o
Expo Go já embarca.

---

## Modos de operação

O app funciona **completo nos dois modos**. A diferença está em *onde* os dados
ficam — e a interface diz isso com todas as letras, nunca finge sincronização
que não aconteceu.

### Modo demonstração (padrão, sem configuração)

Sem `EXPO_PUBLIC_SUPABASE_URL` definido, o app usa o `LocalDataSource`:

- **persistência real** em AsyncStorage — fechar e reabrir o app mantém tudo;
- anexos copiados para o diretório de documentos do app (sobrevivem ao restart);
- conta local com senha salgada e hasheada (SHA-256 via `expo-crypto`);
- Ofertas, Comunidade, Places e Especialistas vêm do catálogo embarcado;
- telas de Configurações e do assistente exibem um aviso explícito de que o
  modo é local.

Ideal para apresentação acadêmica: nada a provisionar, e nenhuma tela vazia.

### Modo produção (com Supabase)

Preenchendo as variáveis, o mesmo código passa a usar o `SupabaseDataSource`:
PostgreSQL, Auth, Storage privado e Row Level Security. **Nenhuma tela muda** —
a troca acontece atrás da interface `DataSource`.

---

## Variáveis de ambiente

Somente `EXPO_PUBLIC_*` chega ao bundle. Veja `.env.example`.

| Variável | Obrigatória | Descrição |
| --- | --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | não | URL do projeto Supabase. Vazio ⇒ modo demonstração. |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | não | Chave anônima. É pública por design; a autorização real é feita por RLS. |
| `EXPO_PUBLIC_BFF_URL` | não | URL das Edge Functions. Vazio ⇒ assistente em modo local rotulado. |

**Nunca** no aplicativo: `GEMINI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` ou
qualquer segredo. Eles vivem apenas no servidor:

```bash
supabase secrets set GEMINI_API_KEY=...
```

Há um teste de segurança que verifica isso — veja [Testes](#testes).

---

## Backend (Supabase)

```bash
# 1. Schema, políticas e buckets
psql "$DATABASE_URL" -f supabase/migrations/0001_schema.sql
psql "$DATABASE_URL" -f supabase/migrations/0002_rls.sql

# 2. Conteúdo editorial (gerado a partir de src/data/catalog.ts)
npm run seed:generate         # regenera supabase/seed.sql
psql "$DATABASE_URL" -f supabase/seed.sql

# 3. BFF
supabase secrets set GEMINI_API_KEY=...
supabase functions deploy ai-chat
supabase functions deploy delete-account
```

Pontos importantes do schema:

- valores **derivados não são colunas** — `status`, `daysLeft`, `totalSpent` e
  `remainingBudget` são calculados no app (`src/domain/selectors.ts`), então não
  têm como divergir dos registros;
- todo registro operacional carrega `trip_id` e cai junto com a viagem
  (`on delete cascade`);
- buckets são **privados**; o app recebe URLs assinadas de curta duração;
- a autorização vem de `auth.uid()` no RLS — o `user_id` enviado pelo cliente
  nunca é usado para autorizar.

---

## Integrações reais

O projeto evita mocks disfarçados de funcionalidade. O que a interface afirma,
ela cumpre:

| Recurso | Fonte | Chave? |
| --- | --- | --- |
| Clima | Open-Meteo | não |
| Câmbio | Frankfurter (BCE) | não |
| Geocodificação do destino | Open-Meteo Geocoding | não |
| Fuso horário | `Intl.DateTimeFormat` (IANA) | — |
| Mapa | `react-native-maps` | não |
| Assistente | Gemini via Edge Function | sim (servidor) |
| Emergência | dataset curado e versionado | — |

Quando um dado não é confiável, o app **diz isso**:

- câmbio indisponível ⇒ a despesa é salva na moeda original e marcada como não
  convertida, em vez de inventar uma taxa;
- país sem dado de emergência validado ⇒ "Não foi possível validar o número
  local", em vez de mostrar 190/192 para qualquer lugar;
- clima servido do cache ⇒ "Atualizado há 2h", nunca "tempo real";
- reserva e consultoria ⇒ "Solicitação enviada. Aguardando confirmação",
  nunca "Reserva confirmada".

A taxa de câmbio usada fica **gravada na despesa** (valor, taxa e timestamp),
para que um gasto histórico não mude de valor quando o mercado se mexe.

---

## Estrutura do projeto

```text
easy-trip/
├── src/
│   ├── app/                    # rotas (Expo Router)
│   │   ├── (auth)/             # login, cadastro, recuperação
│   │   ├── (tabs)/             # Início, Viagens, Objetivos, Assessoria
│   │   ├── trip/[tripId]/      # roteiro, checklist, diário, carteira, tickets
│   │   ├── offers/ community/ places/
│   │   ├── utilities/          # clima, fuso, mapa, SOS
│   │   └── profile/
│   ├── components/
│   │   ├── ui/                 # design system
│   │   └── cards/              # cards de domínio
│   ├── domain/                 # types, schemas (zod), selectors derivados
│   ├── features/trip/          # scaffold e hooks da viagem
│   ├── hooks/                  # camada de dados (TanStack Query)
│   ├── lib/                    # date, currency, storage, files, config
│   ├── providers/              # auth, conectividade, viagem ativa, tema
│   ├── repositories/           # contratos + adaptadores local/Supabase
│   ├── services/               # clima, câmbio, geocoding, fuso, IA, emergência
│   ├── theme/                  # tokens e tema claro/escuro
│   └── data/                   # catálogo editorial e imagens verificadas
├── supabase/
│   ├── migrations/             # schema + RLS
│   ├── functions/              # BFF (Deno)
│   └── seed.sql                # gerado
└── tests/                      # unitários + integração
```

---

## Arquitetura

```text
Telas (Expo Router)
      │
Hooks (TanStack Query)          ← estado de servidor
      │
Repositories (interfaces)       ← a UI só conhece esta camada
      ├── LocalDataSource       (AsyncStorage + FileSystem)
      └── SupabaseDataSource    (Postgres + Storage + RLS)
      │
Services                        ← clima, câmbio, geocoding, fuso, IA, SOS
      │
BFF (Edge Functions)            ← única camada com segredos
```

**A regra de ouro (§12):** uma viagem existe uma única vez. Todo recurso
operacional carrega o mesmo `tripId`, e o estado global guarda apenas o
`currentTripId` — um id, não uma cópia da viagem. É isso que torna
estruturalmente impossível o header dizer "Paris" enquanto as despesas são de
Kyoto.

Estado separado em três níveis (§11):

- **servidor** — TanStack Query (viagens, despesas, tickets…);
- **sessão** — usuário autenticado, `currentTripId`, conectividade;
- **UI local** — modal aberto, aba ativa, busca, filtro.

---

## Testes

```bash
npm test          # 73 testes
npm run typecheck # TypeScript strict
npm run lint      # ESLint
```

Cobertura atual:

- **unitários** — status da viagem, contagem regressiva, soma de despesas,
  orçamento restante, estouro de orçamento, progresso de checklist e metas,
  estatísticas do perfil, datas (incluindo ano bissexto e DST), moeda
  (pt-BR e ponto decimal), fusos (offsets fracionários +05:45/+09:30 e horário
  de verão), e todos os schemas de validação;
- **integração** — criação de viagem, isolamento entre viagens (Paris × Kyoto),
  cascata de exclusão, persistência de perfil, likes e favoritos, solicitações
  que nascem como `requested`, e exclusão de conta.

### Verificação de segredos (§104)

O bundle é auditável a qualquer momento:

```bash
npx expo export --platform android --output-dir .secscan
grep -c "GEMINI_API_KEY\|service_role" .secscan/_expo/static/js/android/*.hbc
rm -rf .secscan
```

O resultado esperado é `0` — inclusive o host do Gemini não aparece, porque o
app fala apenas com o BFF.

---

## Decisões de compatibilidade com Expo Go

| Necessidade | Decisão | Motivo |
| --- | --- | --- |
| Bottom sheet | `Modal` + `Animated` próprios | bibliotecas de sheet exigem módulo nativo fora do Expo Go |
| Mapa | `react-native-maps` | **está** embarcado no Expo Go do SDK 57 — mapa real, não imagem |
| PDF | abre no visualizador do sistema | renderizar in-app exigiria módulo incompatível; a intenção é preservada |
| Streaming da IA | resposta única com estado de digitação | streaming não é confiável no runtime do Expo Go (§50) |
| Blur | `expo-blur` no iOS, superfície sólida no Android | custo de frame em aparelhos modestos (§69) |

Regra geral: quando a solução tecnicamente ideal quebra o Expo Go, preserva-se
a **intenção** da funcionalidade com a alternativa mais próxima que funciona.

---

## Licença

Projeto acadêmico. Conteúdo editorial e fotografias são ilustrativos; as
fotografias vêm do Unsplash e todo componente de imagem tem fallback próprio.
