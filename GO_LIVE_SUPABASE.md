# Go-live do Supabase remoto — runbook

> **Snapshot histórico (fase F10, agosto de 2026).** As contagens, segredos
> pendentes e Functions não publicadas abaixo descrevem aquela fase, não o
> ambiente atual. Em 21/09/2026 o remoto tinha `0001`–`0012` e quatro Functions
> publicadas; o repositório contém `0001`–`0018` e seis Functions. Consulte o
> [relatório atual](docs/RELATORIO_ALINHAMENTO_CODIGO_TCC_FINAL.md) antes de
> planejar uma publicação. Este roteiro não cobre sozinho o schema atual.

Este arquivo é para ser **executado depois** da F10, com atenção e uma etapa por
vez. Nada aqui foi executado durante a auditoria: o projeto remoto continua
exatamente como estava.

Ele descreve a **primeira** aplicação do schema a um projeto Supabase hospedado.
A ordem importa, e cada bloco termina com uma verificação que decide se a
próxima etapa pode começar.

> **Regra que vale para o documento inteiro:** se uma verificação não der o
> resultado descrito, **pare**. Não improvise, não force, não "limpa e começa de
> novo". A seção [Critérios de parada](#9-critérios-de-parada) explica o porquê.

---

## 0. O que já está pronto e o que não está

| Item | Estado |
|---|---|
| Migrations `0001`→`0007` | ✅ prontas, aplicadas do zero e testadas localmente |
| RLS, policies, grants | ✅ testadas com JWT real (257 verificações E2E) |
| Buckets e políticas de Storage | ✅ definidos na `0002`/`0006`/`0007` |
| Edge Functions | ✅ escritas e testadas localmente, **não publicadas** |
| Seed de produção | ✅ `supabase/seed.production.sql` gerado e validado |
| Imagens editoriais próprias | ⛔ 18 arquivos ainda não existem — ver `assets/content/README.md` |
| Site URL / Redirect URLs / SMTP | ⛔ configuração de painel, ainda não feita |
| Secrets do servidor | ⛔ `GEMINI_API_KEY` ainda não definida no projeto |

---

## 1. Pré-check (nada é escrito nesta seção)

### 1.1 Árvore de trabalho conhecida

```bash
git status                 # deve estar limpo, ou com apenas o que você pretende publicar
git rev-parse HEAD         # anote este hash: é o que está indo para produção
```

Anote o hash em algum lugar fora do terminal. Se algo der errado depois, é ele
que diz qual código corresponde ao banco que foi aplicado.

### 1.2 Autenticar a CLI

```bash
npx supabase login
```

### 1.3 Confirmar o projeto — a checagem mais importante desta seção

```bash
npx supabase projects list
npx supabase link --project-ref <PROJECT_REF>
npx supabase status          # confirme o ref e a URL exibidos
```

O projeto deste repositório é o **`easy-trip`**, ref `mqyrtajbfwucjvkfqwbn`. Se
o `link` apontar para outro ref, **pare aqui**: todo o resto deste runbook é
destrutivo no projeto errado.

### 1.4 Ver o que o remoto já tem (somente leitura)

```bash
npx supabase migration list           # compara local × remoto
```

Resultado esperado numa primeira aplicação: as sete migrations aparecem como
locais, **nenhuma** como remota.

**Pare se** aparecer qualquer migration remota que você não reconhece, ou se o
remoto já tiver tabelas em `public`. Um banco que já tem estado não recebe um
primeiro `db push` sem análise — ver [§9](#9-critérios-de-parada).

---

## 2. Migrations

### 2.1 O que vai subir, nesta ordem

| Migration | O que traz |
|---|---|
| `0001_schema.sql` | 21 tabelas, constraints, índices |
| `0002_rls.sql` | RLS em tudo, policies por dono, buckets `avatars`/`attachments`/`journal` |
| `0003_admin_roles.sql` | `profiles.role`, `public.is_admin()`, policies administrativas |
| `0004_content_publishing.sql` | `offers.status`/`sort_order`, `advisors.active`, gatilhos `updated_at` |
| `0005_grants.sql` | privilégios de coluna para `authenticated` |
| `0006_profile_hardening.sql` | bloqueio de escalada de papel, limites do bucket `avatars` |
| `0007_storage_hardening.sql` | bucket `content`, limites de `attachments`/`journal` |

### 2.2 Aplicar

```bash
npx supabase db push
```

Sem `--include-all`, sem `--dry-run` como substituto da leitura acima, e **sem**
nenhuma flag destrutiva. Se a CLI pedir confirmação, leia a lista antes de
aceitar: ela é a última chance de perceber que o projeto é o errado.

### 2.3 Verificar

```bash
npx supabase migration list           # as sete agora aparecem dos dois lados
```

No SQL Editor do painel:

```sql
select tablename, rowsecurity from pg_tables
 where schemaname = 'public' order by tablename;
-- rowsecurity precisa ser `true` em TODAS as tabelas.

select count(*) from pg_policies where schemaname = 'public';
-- precisa ser > 0 e cobrir profiles, trips, articles, offers, places, advisors.

select id, public, file_size_limit, allowed_mime_types from storage.buckets;
-- avatars(privado,5MB) · attachments(privado,10MB) · journal(privado,10MB) · content(PÚBLICO,5MB)
```

**Pare se** alguma tabela vier com `rowsecurity = false`.

---

## 3. Seed

> `supabase db push` **não** executa seed nenhum. Ele só roda migrations. O
> banco recém-aplicado está vazio de conteúdo, e é assim que deve ser.

### 3.1 O arquivo certo

| Arquivo | Para quê | Vai para o remoto? |
|---|---|---|
| `supabase/seed.sql` | demonstração local: 6 ofertas, 6 artigos, 12 lugares, 5 especialistas | **NÃO** |
| `supabase/seed.production.sql` | 6 artigos (assinatura institucional) + 12 lugares (sem telefone, sem nota) | Sim, manualmente |

O seed de produção **omite de propósito**:

- **especialistas** — são cinco pessoas fictícias (decisão D-05). O diretório da
  Assessoria nasce vazio e é preenchido pelo painel, com pessoas reais;
- **ofertas** — preço, desconto e vigência são compromisso comercial. Entram
  pelo painel, digitadas por quem as assume;
- **telefone e nota dos lugares** — números não verificados viram um botão
  "Ligar" que toca no telefone de um estranho; nota sem fonte é alegação que o
  produto não sustenta.

### 3.2 Aplicar (opcional — o app funciona vazio)

Pelo SQL Editor do painel, colando o conteúdo de `supabase/seed.production.sql`,
ou via `psql` com a connection string do projeto:

```bash
psql "$SUPABASE_DB_URL" -f supabase/seed.production.sql
```

O arquivo é idempotente (`on conflict (id) do nothing`) e pode ser reaplicado.

### 3.3 Proibido

```bash
npx supabase db reset --linked     # ⛔ APAGA O BANCO REMOTO INTEIRO
psql "$SUPABASE_DB_URL" -f supabase/seed.sql   # ⛔ sobe pessoas fictícias
```

---

## 4. Storage

Os quatro buckets vêm das migrations, então não há nada a criar. Confira no
painel (Storage → Configuration) que a tabela do §2.3 bate, em especial:

- `content` é o **único** público, e só para leitura;
- os outros três são privados e só o dono lê, por `auth.uid()`.

### 4.1 Imagens editoriais

O script de migração de imagens **só roda contra o Supabase local** — ele recusa
qualquer host que não seja `127.0.0.1`/`localhost`, por construção.

Para o remoto, o caminho é o painel administrativo: entrar como admin e enviar a
imagem pelo formulário, que é exatamente o fluxo fechado na F9. Enquanto isso, o
conteúdo do seed continua exibindo as imagens externas que já usava.

Ver `assets/content/README.md` e `assets/content/manifest.json` para a lista dos
18 arquivos que faltam para produção.

---

## 5. Edge Functions

| Função | Para quê | JWT | Secrets |
|---|---|---|---|
| `ai-chat` | Easy Trip IA — guarda a chave do Gemini fora do aplicativo | obrigatório | `GEMINI_API_KEY` |
| `admin-generate-content` | "Preencher com IA" do painel; confere `profiles.role = 'admin'` no servidor | obrigatório | `GEMINI_API_KEY` |
| `delete-account` | exclusão de conta (LGPD): apaga linhas, objetos e o usuário | obrigatório | nenhum extra |

Nenhuma delas é opcional se o recurso correspondente for usado, e nenhuma é
código morto.

### 5.1 Secrets primeiro, deploy depois

```bash
npx supabase secrets set GEMINI_API_KEY=...      # o valor NÃO mora neste repositório
npx supabase secrets list                        # confirme o nome, sem ver o valor
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` **não** devem
ser definidas: a plataforma as injeta sozinha, e o prefixo `SUPABASE_` é
reservado — `secrets set` recusa.

### 5.2 Publicar

```bash
npx supabase functions deploy ai-chat
npx supabase functions deploy admin-generate-content
npx supabase functions deploy delete-account
```

`verify_jwt` já está ligado para as três em `supabase/config.toml`.

---

## 6. Autenticação (painel — Authentication → URL Configuration)

Decisões que **precisam ser tomadas** por quem opera, não pelo runbook:

| Item | Valor | Observação |
|---|---|---|
| Site URL | a URL do aplicativo | no Expo Go, o deep link é gerado por `Linking.createURL` |
| Redirect URLs | `easytrip://*` e a URL `exp://` da sua máquina em desenvolvimento | o `scheme` é `easytrip` (`app.json`) |
| Confirm email | **decidir** | o código trata os dois casos; com confirmação ativa, o cadastro não devolve sessão e o app pede a confirmação |
| SMTP | **decidir** | o SMTP embutido do Supabase tem limite baixo e não serve para uso real; recuperação de senha depende disto |

A recuperação de senha usa `redirectTo` derivado de `Linking.createURL('/reset-password')`.
Se essa URL não estiver na lista de Redirect URLs, o e-mail chega e o link não abre.

---

## 7. Configuração do aplicativo

No `.env` (nunca commitado):

```
EXPO_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<chave PÚBLICA: anon / sb_publishable_...>
```

`EXPO_PUBLIC_BFF_URL` não entra aqui: num projeto hospedado o aplicativo deduz
`https://<ref>.supabase.co/functions/v1` da URL acima. Defina-a apenas para
instância própria, domínio na frente das Functions ou `supabase functions
serve` (`http://127.0.0.1:54321/functions/v1`) — nesses casos ela vence a
dedução. Ajustes mostra qual das duas origens está em uso.

⚠️ A chave publicável e a secreta ficam lado a lado no painel e se parecem. O
aplicativo **detecta e recusa** uma chave `service_role`/`sb_secret_` colada aí
(cai em modo demonstração e mostra o motivo em Ajustes), mas confira o rótulo
antes: com a chave errada, a RLS não valeria para ninguém.

Configuração opcional, em código e não em ambiente:

- `src/constants/contact.ts` → `EASYTRIP_CONTACT_WHATSAPP` (vazio = o botão de
  contato comercial não aparece);
- `src/constants/community.ts` → `WHATSAPP_COMMUNITY_URL` (vazio = o cartão da
  comunidade avisa que o convite não foi configurado).

---

## 8. Teste de fumaça (com UMA conta de teste controlada)

Depois de tudo aplicado, com um e-mail que você controla:

1. cadastro;
2. confirmação de e-mail, se estiver ativa;
3. login;
4. abrir Ajustes — **não** pode aparecer o aviso de modo demonstração;
5. editar o perfil;
6. trocar o avatar (upload → aparece → a foto anterior sai do bucket);
7. criar uma viagem;
8. roteiro, checklist e uma despesa;
9. anexar um documento e abri-lo;
10. um registro no diário com foto;
11. modo avião: o documento espelhado continua abrindo;
12. ver o conteúdo editorial público;
13. logout e login de novo — os dados continuam;
14. recuperação de senha pelo e-mail;
15. promover a conta a admin pelo SQL Editor, entrar no painel, publicar um
    artigo com imagem, conferir na Comunidade, despublicar;
16. rebaixar a conta e confirmar que o painel deixa de abrir;
17. excluir a conta e conferir no painel que não sobrou linha nem objeto.

O passo 17 é destrutivo e é o ponto do teste: ele prova a exclusão de dados
(LGPD) no ambiente real.

---

## 9. Critérios de parada

Pare, diagnostique e só então continue se:

- o `project-ref` não for o esperado;
- `migration list` mostrar migration remota desconhecida;
- o remoto já tiver tabelas em `public` de outra origem;
- alguma tabela ficar com `rowsecurity = false`;
- o `db push` falhar no meio (uma migration aplicada, a seguinte não);
- a chave publicável não for a publicável;
- `GEMINI_API_KEY` faltar e a IA for necessária.

**Como corrigir, se o push falhar no meio:** o banco fica no estado da última
migration aplicada com sucesso. Não desfaça à mão, não apague o schema e não
desligue a RLS "temporariamente". Corrija a migration que falhou — ou escreva
uma `0008` que complete o que faltou — e rode `db push` de novo. Migrations são
aditivas neste projeto; recomeçar do zero é a única operação que perde dados.

---

## 10. Nunca faça

| Proibido | Por quê |
|---|---|
| `npx supabase db reset --linked` | apaga o banco remoto inteiro |
| aplicar `supabase/seed.sql` no remoto | sobe cinco pessoas fictícias e seis ofertas com preço inventado |
| criar usuários de teste em massa no remoto | vira dado real de gente que não existe |
| pôr a chave `service_role` no aplicativo | desliga a RLS para todo mundo com o APK |
| `alter table ... disable row level security` | remove a única barreira entre um usuário e os dados de outro |
| policy `using (true)` "temporária" | idem, e ninguém lembra de remover |
| commitar `.env` | as chaves vazam no histórico do Git, mesmo depois de removidas |
| apagar o schema remoto "para começar limpo" | é a operação que este runbook inteiro existe para evitar |
