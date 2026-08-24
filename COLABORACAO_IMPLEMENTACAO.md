# Easy Trip Colaborativo — relatório de implementação

**Status:** CONCLUÍDO (local).
**DB push remoto executado:** NÃO.
**Edge Functions publicadas:** NÃO.
**Migrations 0001–0007:** intocadas.

Tudo abaixo foi implementado e validado localmente. Nada foi para produção.

---

## 1. Arquitetura de colaboração

Uma viagem deixou de ser um objeto de uma pessoa e passou a ser um objeto
compartilhável, no modelo de um arquivo compartilhado.

```
trips ──┬── trip_members (owner | editor | viewer)   ← a autorização
        └── trip_invites (pending → accepted/declined/cancelled)

conteúdo da viagem ── visibility (shared | private) + created_by
```

Três camadas, e cada uma responde a uma pergunta diferente:

| Camada | Pergunta | Onde |
|---|---|---|
| Participação | você está nesta viagem? | `is_trip_member()` |
| Poder de escrita | você pode alterar conteúdo compartilhado? | `can_edit_trip()` |
| Visibilidade do item | você vê **este** registro? | `visibility` + `created_by` |

`trips.user_id` **não** foi removido: continua sendo o proprietário original, o
que sustenta o `on delete cascade` da conta e serve de rede de segurança se uma
linha de `trip_members` se perder. Quem manda na autorização, porém, passou a
ser `trip_members`.

**Decisão estrutural:** `trip_members` e `trip_invites` não têm policy de
escrita nenhuma. Todas as mutações passam por funções `security definer`
(`create_trip_invite`, `accept_trip_invite`, `leave_trip`, …). As regras de
colaboração são um protocolo — não convidar duas vezes, não aceitar convite
alheio, o proprietário não sair deixando a viagem sem dono — e uma cláusula
`with check` não expressa isso sem virar um emaranhado ilegível.

## 2. Migrations criadas

| Arquivo | O que faz |
|---|---|
| `0008_trip_collaboration.sql` | `trip_members`, `trip_invites`, helpers de autorização, RPCs do protocolo, `trip_member_profiles`, RLS por participação, backfill, publicação Realtime |
| `0009_trip_visibility.sql` | `visibility` + `created_by` (+ `paid_by` em despesas), backfill assimétrico, trigger `set_created_by`, RLS com a regra única, policies de Storage para arquivo compartilhado |
| `0010_notifications_reminders.sql` | `notifications`, `reminders`, `deliver_due_reminders`, redefinição dos RPCs com notificação, `purge_unreachable_private_content` |
| `0011_reservations.sql` | Extensão de `tickets` para Reservas, normalização de tipos, `updated_at`, localização no roteiro, limpeza de lembretes órfãos |
| `0012_trip_suggestions.sql` | `trip_suggestions`, `trips.suggestions_refreshed_at` |

Cada uma é idempotente onde faz sentido, tem índices, FKs, constraints, RLS,
grants, comentários e um bloco de conferência que **falha alto** se o backfill
não convergir.

## 3. Backfill

Testado duas vezes: base do zero (0001→0012) e base com dados legados
(0001→0007 + dados + 0008→0012). Nenhum dado desapareceu.

| Dado | Resultado |
|---|---|
| Toda viagem existente | ganhou `trip_members` com `role = owner` |
| Roteiro / Checklist | `visibility = shared`, `created_by` = dono da viagem |
| Despesas | `visibility = private`, `created_by` e `paid_by` = `user_id` |
| Diário | `visibility = private`, `created_by` = `user_id` |
| Reservas (ex-tickets) | `visibility = **private**` — ver abaixo |
| `tickets.type` | `voo→flight`, `hospedagem→hotel`, `atracao→park_ticket`, `transporte→other`, `outro→other`; original preservado em `legacy_type` |

**A assimetria das reservas é deliberada.** Uma reserva criada de hoje em diante
nasce compartilhada, porque quem a cria já sabe que a viagem tem gente dentro.
Uma reserva que já existia foi criada quando a viagem era de uma pessoa só, com
frequência com documento anexado (cartão de embarque, voucher com nome completo
e localizador). Marcá-la `shared` no backfill entregaria esse arquivo ao
primeiro convidado sem que ninguém tivesse decidido nada. Entrar como `private`
e deixar a pessoa compartilhar é o erro reversível; o contrário não é.

**`transporte → other` é a única tradução com perda.** Podia ser trem, ônibus
ou carro alugado e o registro não diz qual. Inventar `train` faria a tela mentir
sobre o que a pessoa guardou; `other` mantém o registro inteiro e muda só o
ícone. `legacy_type` guarda de onde veio.

## 4–7. Membros, convites, papéis e matriz RLS

**Papéis**

| | ler shared | escrever shared | gerenciar membros | editar a viagem |
|---|---|---|---|---|
| owner | ✅ | ✅ | ✅ | ✅ |
| editor | ✅ | ✅ | ❌ | ❌ |
| viewer | ✅ | ❌ | ❌ | ❌ |
| outsider | ❌ | ❌ | ❌ | ❌ |

Editar destino, datas e orçamento é do **proprietário**, não do editor: é decisão
sobre a viagem, não colaboração de conteúdo.

**Convites** — `trip_invites`, com índice único parcial que garante **um convite
pendente por pessoa e por viagem** (recusar e ser convidado de novo é legítimo;
dois pendentes ao mesmo tempo é replay). Recusados pelo servidor: auto-convite,
convite duplicado, convite a quem já é membro, viewer/editor convidando,
aceitar convite alheio, aceitar duas vezes, responder convite não-pendente.

**Resolução de e-mail** — `create_trip_invite(trip, email, role)` é a única
porta que enxerga `auth.users`. Recebe um e-mail exato, devolve no máximo um
convite, nunca uma lista. O cliente não consulta o diretório de usuários.
"Convite não encontrado" é a mesma mensagem para "não existe" e "não é seu",
para a função não virar um oráculo de ids.

**Matriz executada** (`supabase/tests/rls_collaboration.test.sql`, 62 asserções,
todas verdes contra Postgres real):

- OWNER/EDITOR/VIEWER/OUTSIDER × ler/escrever/gerenciar;
- privado de A invisível para B, C **e para o proprietário**;
- `notify()` não é chamável pelo cliente; ninguém insere notificação (nem para si);
- lembrete é por pessoa e não é entregue por outra conta;
- ex-membro perde acesso; conteúdo compartilhado dele fica; privado dele fica inacessível.

## 8. Modelo de visibilidade

Regra única de leitura, **sem exceção**:

```
é membro da viagem  AND  (visibility = 'shared'  OR  created_by = auth.uid())
```

Não existe bypass de proprietário. Se existisse, "somente eu" seria uma etiqueta
e não uma garantia. O teste que mais importa do repositório é a linha
`PROPRIETÁRIO A **não** lê o diário privado de B`.

O `using` de UPDATE/DELETE repete a condição de SELECT — sem isso, um editor
apagaria uma linha privada alheia sem nunca poder lê-la, bastando acertar o id.

`created_by` é escrito por trigger no banco (`set_created_by`), a partir de
`auth.uid()`. Não vem do cliente.

## 9–11. Defaults de privacidade

| Área | Criação | Backfill |
|---|---|---|
| Roteiro | shared | shared |
| Checklist | shared | shared |
| Reservas | shared | **private** |
| Despesas | **private** | private |
| Diário | **private** | private |

`goals` fica de fora (é do usuário, não da viagem); `journal_media` herda da
entrada (duas fontes de verdade divergiriam no primeiro update);
`trip_suggestions` é da viagem por definição (§48).

## 12–14. Despesas e Carteira

`paid_by` e `created_by` gravados desde já — não há divisão de conta, rateio,
acerto nem Pix nesta fase, e é **por isso** que o dado precisa ser registrado
agora: reconstruí-lo depois seria impossível.

Filtros: **Todas visíveis** · **Compartilhadas** · **Minhas**. "Minhas" é quem
lançou **ou** quem pagou — uma despesa lançada por Maria e paga por João
pertence aos dois de maneiras diferentes. Os filtros somem em viagem individual.

O prompt da IA proíbe explicitamente escrever que alguém "deve" um valor a
outra pessoa.

## 15–16. IA e privacidade

**Duas camadas independentes:**

1. **RLS** — o conteúdo privado alheio não chega ao aparelho. Não é escondido,
   ele não existe lá.
2. **`buildTripContext`** — filtra de novo antes de virar prompt. Redundante
   hoje, e é bom que seja: cobre a fonte local (sem Postgres) e o dia em que uma
   consulta nova esquecer um filtro. O que ele evita é vazar o diário de alguém
   para dentro de um prompt, de onde não há como tirar depois.

**O diário nunca entra no contexto, privado ou compartilhado.** Não há parâmetro
para ele em `buildTripContext` — a ausência é a garantia.

Cada despesa no contexto leva `shared` e `mine`, para o modelo separar "quanto
vamos gastar" de "quanto eu gastei" (§57). O prompt do sistema foi estendido com
uma seção de viagem compartilhada.

**Review Sheet** oferece visibilidade por tipo de conteúdo (roteiro, checklist,
despesa) — uma chave única forçaria escolher entre expor o gasto ou esconder o
roteiro. Só aparece quando a viagem tem mais de um viajante. A escrita continua
pela sessão do usuário, sob RLS.

## 17–21. Rota, distância e clima

**Localização** — `place_name`, `address`, `latitude`, `longitude`,
`place_source` (`catalog`/`geocoding`/`manual`/`suggestion`). CHECK
`itinerary_coords_pair` garante que coordenada é par ou nada: meia coordenada
entraria no mapa como (48.86, 0), o Golfo da Guiné.

**Mini mapa** — aparece com ≥2 paradas com coordenada. Markers numerados,
`Polyline` na **ordem do roteiro** (não a geograficamente mais curta:
reordenar transformaria o mapa numa proposta diferente do que está escrito
acima).

**Distância — auditoria feita: não existe provedor de rotas no projeto.** Não há
Directions API, OSRM ou equivalente. O cálculo é Haversine, e o texto diz
exatamente isso:

> ≈ 7,4 km em linha reta entre os pontos
> 3 paradas · a distância real de caminhada ou carro é maior

Nunca "distância de carro", nunca tempo de deslocamento. O botão **Abrir no
Maps** manda a rota inteira, na ordem do roteiro, para quem tem o cálculo de
verdade.

**Clima** — Open-Meteo real, horário a horário, nunca o Gemini. Fora do
horizonte de 16 dias: *"Previsão disponível mais perto da data."* Previsão
servida do cache é marcada como tal, com o `updatedAt` do cache — não o de
agora.

## 22–29. Reservas

"Tickets" virou "Reservas" em toda a interface: rótulos, títulos, navegação,
empty states, acessibilidade, alertas e rotas.

**A tabela continua se chamando `tickets`.** Renomeá-la não acrescentaria nada
que o usuário perceba e custaria uma migration destrutiva sobre dados em
produção — caminhos de Storage referenciados por linha, policies, o `trip_id` de
que a 0008 depende. O nome da tabela não é o nome do produto. Do repositório
para cima, "ticket" não existe mais: `Ticket`, `TicketRepository`,
`useTickets` e a tela antiga foram removidos.

**Forma do registro:** o que é comum a todas as modalidades é coluna (tipo,
título, fornecedor, localizador, início, fim, origem, destino, endereço,
situação, anexo) — é por esses campos que a lista ordena, agrupa e ancora
lembretes. O que é específico vai para `details jsonb`, validado por schema Zod
por tipo. Como colunas seriam ~25 campos anuláveis dos quais cada linha usaria
cinco.

| Modalidade | Campos específicos |
|---|---|
| ✈️ Voo | número do voo, terminais, assento, bagagem |
| 🏨 Hospedagem | quarto, telefone, hóspedes |
| 🚗 Carro | modelo, categoria, condutor |
| 🎟️ Ingresso | quantidade, entrada |
| 🚆 Trem / 🚌 Ônibus | assento, vagão/setor, plataforma |

Rótulos por modalidade: "Check-in/Check-out" no hotel, "Partida/Chegada" no voo,
"Retirada/Devolução" no carro. Nenhum QR é gerado (§28).

`reference` continua sendo o localizador — não foi criada uma coluna
`confirmation_code` nova: duas colunas para o mesmo dado garantiriam que metade
das telas leria a errada.

## 30–33. Lembretes e push

`reminders` é entidade própria, **por usuário** (`unique(user_id, entity_type,
entity_id, anchor)`). Maria ativar lembrete não faz João receber nada. Um
`viewer` pode ativar lembretes: ele não está mudando a viagem, está mudando a
própria agenda.

Opções: 15 min · 30 min · 1 h · 3 h · 1 dia (+ personalizado, teto de 7 dias).
Opção que cairia no passado não é oferecida, e `computeRemindAt` recusa criar
lembrete vencido — a Central anunciaria "Check-in amanhã" para um check-in de
ontem.

**Push do sistema operacional: NÃO EXISTE, e a interface diz isso.**

Auditoria: `expo-notifications` **não está instalado**; não há
`expo-device`+token registrado, não há tabela de device tokens, não há provider
de push. O que foi implementado:

- Central in-app real (`notifications`), com badge de não lidas;
- entrega no primeiro momento em que o aplicativo abre depois do horário
  (`deliver_due_reminders`, idempotente por `sent_at`);
- texto explícito no seletor: *"O aviso aparece na Central de notificações do
  Easy Trip quando você abrir o aplicativo depois do horário. O Easy Trip ainda
  não envia notificações do sistema."*

**O que falta para OS Push** (pendência documentada): instalar
`expo-notifications`; tabela `push_tokens` (user_id, token, platform) com RLS;
registro de token no login e limpeza no logout; credenciais FCM/APNs; um sender
server-side chamando o Expo Push API a partir de `deliver_due_reminders`;
build nativo — **Expo Go não entrega push remoto no SDK atual**, então isso
implica development build. Nada disso foi fingido: não há botão, campo ou texto
prometendo notificação de sistema. Expo Go continua funcionando.

## 34–38. Briefing diário

`supabase/functions/trip-daily-briefing` — **escrita, não publicada.**

- Server-side, para existir com o aplicativo fechado (§35). Agendamento por
  Supabase Cron documentado no cabeçalho do arquivo (não aplicado).
- **Timezone do destino** (§36): `zoneDate()` reimplementa `getZoneDate`; a
  janela de disparo é 7h–9h locais. Um cron às 23h UTC veria dia 24 enquanto em
  Tóquio já é 25.
- **Sem duplicata**: índice único
  `notifications_daily_briefing_once (user_id, tripId, date)`. A unicidade mora
  no banco, não num `if` — duas execuções simultâneas do cron passariam pelo
  `if` antes de qualquer uma gravar.
- **Privacidade**: a função roda com `service_role`, que ignora RLS. A regra da
  0009 é reimplementada à mão em `visibleTo()`, e **cada membro recebe o dia que
  ele vê**. É o ponto mais sensível do arquivo, marcado como tal.
- **Clima real** do Open-Meteo. Falhou? O briefing sai sem clima — não se
  inventa temperatura.
- **Gemini escreve o texto** a partir do roteiro e da previsão. Falhou?
  `deterministicBriefing` monta um resumo verdadeiro por regra, e a notificação
  grava `generatedBy: 'rules'` — não é apresentada como mensagem da IA.
- **Custo**: no máximo um briefing por usuário/viagem/dia, garantido pelo índice.

## 39–48. Módulo Sugestões

Detalhe da viagem passou de `Roteiro · Carteira · Tickets` para
`Roteiro · Carteira · Reservas · Sugestões`.

**Ordem das fontes** (§41): primeiro `public.places` real (`source: 'catalog'`),
depois a IA para completar (`source: 'ai'`). A tela mostra "✨ Sugestão da IA"
pelo **campo**, não por heurística de texto.

**O que uma sugestão não pode afirmar**: preço, horário de funcionamento,
avaliação, disponibilidade, promoção, URL. Não existe coluna nem campo de schema
para nenhum deles — a ausência é a validação, e é mais forte que instrução em
prosa. `sanitizeSuggestion` na Edge Function reconstrói o objeto campo a campo:
o que ela não copia, não sai.

**Cache e refresh** (§43): persistido em `trip_suggestions`; `ensure()` só
completa quando está abaixo do mínimo (3). Botão "Atualizar sugestões" limitado
a 6 h por `trips.suggestions_refreshed_at`, escrito mesmo quando nada novo entra
— senão uma viagem sem catálogo geraria uma chamada por toque.

**Adicionar ao roteiro** (§45–§47): folha de revisão com data, horário, duração,
localização, visibilidade e observações. A coordenada viaja junto e
`place_source = 'suggestion'` — o item passa a participar do mini mapa, da
distância e do clima por horário.

**Deduplicação** (§46): título normalizado (sem acento, sem artigos, sem
"museu") **ou** coordenadas a menos de 120 m — "Torre Eiffel" e "Champ de Mars"
são a mesma parada. Avisa e oferece "Adicionar mesmo assim"; nunca bloqueia nem
duplica em silêncio.

Sugestões são da viagem: todos veem, `viewer` só olha, editor/owner adiciona.

## 49–52. Tela de membros e saída

`👥 N viajantes` discreto no Roteiro (some em viagem individual — "👥 1" em todo
card é ruído). Tela de Viajantes com papel em ícone **e** texto, convites
pendentes, e para o proprietário: alterar Editor↔Viewer, remover, cancelar
convite.

**Saída** (§50): colaborador sai com confirmação. O proprietário **não** sai
enquanto houver outra pessoa — sairia deixando a viagem sem quem a gerencie e o
conteúdo compartilhado dos outros órfão. `set_trip_member_role` recusa promover
a `owner`: transferência de propriedade não existe nesta fase, e improvisar uma
sem confirmação e sem rebaixar o anterior criaria duas pessoas donas da mesma
viagem.

**Política de conteúdo de ex-membro** (§51, §52), testada:

- **compartilhado fica** — pertence à viagem, não a quem digitou; autoria
  histórica preservada em `created_by`, e `trip_member_profiles` devolve o nome
  de quem já saiu para "Adicionado por Maria" não virar "Adicionado por
  Viajante";
- **privado fica onde está e deixa de ser legível por qualquer pessoa** — não é
  entregue ao proprietário, não é reclassificado, não aparece em lugar nenhum;
- limpeza deliberada por `purge_unreachable_private_content(trip)`, apenas
  `service_role`, nunca automática — remoção acidental acontece, e reconvidar
  devolve o acesso; apagar seria irreversível a partir de um clique reversível.

Minimização de PII: `profiles` continua fechado (telefone, cidade, fuso e estilo
de viagem não pertencem a quem divide um roteiro). Só id e nome saem, por
`trip_member_profiles`.

## 53. Concorrência

Last-write-wins com `updated_at` escrito por trigger no banco — o instante é do
servidor, não do cliente. Sem CRDT, e a interface não finge edição simultânea
tipo Google Docs.

## 8/58. Realtime

Uma assinatura por viagem aberta, filtrada por `trip_id`; mais um canal de
notificações filtrado por `user_id` (o convite chega para uma viagem que o
convidado ainda não pode abrir). Cleanup por `removeChannel` — `unsubscribe`
deixaria canais mortos contando para o limite de conexões.

**Invalida, não aplica o payload.** O evento traz a linha crua, sem URLs
assinadas e sem passar pelos mappers; escrevê-la no cache criaria um segundo
caminho de leitura com formato ligeiramente diferente. Invalidar é mais lento e
é certo — e resolve de graça o conflito entre evento realtime e mutação
otimista local, porque o refetch converge para o que o servidor tem.

O payload nunca é lido: o único uso é "invalide esta chave". Mesmo que um dia
vazasse, não teria por onde aparecer na tela.

## 54–56. Notificações e Home

Tipos: `trip_invite`, `trip_invite_accepted`, `trip_member_removed`,
`trip_role_changed`, `trip_daily_briefing`, `reservation_reminder`,
`trip_reminder`. **Nada é gerado para checklist marcado** (§54).

`notifications` **não tem policy de INSERT** para `authenticated` (§64). Quem
escreve são as funções `security definer` e o `service_role`. `notify()` é
revogada de `authenticated`.

Convite é respondido **de dentro da notificação** — mandar a pessoa procurar a
viagem seria impossível: ela ainda não tem acesso.

O sino ficou com duas marcações, porque são duas coisas: **número** = não lidas
(eventos que se pode zerar); **ponto** = há avisos derivados da viagem
(orçamento no limite, checklist pendente) que não têm como ser "lidos". Contá-los
no número faria o badge nunca chegar a zero, e um badge que não zera deixa de ser
lido em uma semana.

Home lista viagens próprias **e** compartilhadas aceitas: o `.eq('user_id', …)`
saiu de `trips.list` — era autorização e filtro ao mesmo tempo, e agora seria o
filtro errado. Quem decide é a policy. Ordenação preservada. Cards de viagem
compartilhada mostram `👥 N`, com o estado também no rótulo de acessibilidade.

## 59. Offline e cache

Sem fila offline de mutations — decisão anterior mantida. Reads compartilhados
usam cache persistido, escopado por conta (`snapshot.userId`).

**Novo:** `useRevokedTripCleanup` remove do cache todas as chaves de uma viagem
assim que chega `trip_member_removed`. Sem isso, quem foi removido continuaria
com o roteiro em disco e a Home o mostraria por um instante na próxima abertura,
antes de o refetch corrigir — tempo suficiente para ler o que não deveria mais
ver. `removeQueries`, não `invalidateQueries`: invalidar pediria os dados de
novo e o servidor recusaria.

## 68. LocalDataSource

Funcionam de verdade e persistem: reservas, lembretes, notificações, entrega de
lembrete vencido, visibilidade, sugestões (do catálogo embarcado, marcadas
`catalog`), lista de membros (o criador, como `owner`).

Recusam com `DemoUnavailableError` — convidar, aceitar, alterar permissão,
remover, sair. A tela transforma isso em *"Convidar outros viajantes fica
disponível quando o aplicativo estiver conectado."* **Nenhum botão falso**: um
convite que fingisse ter sido enviado seria a pior coisa que a fonte local
poderia fazer.

## 69–70. UI/UX e acessibilidade

Cards, bottom sheets, chips, segmented controls e badges discretos. Tema claro e
escuro preservados. Sem cards gigantes, sem múltiplos "Adicionar".

Nada depende só de cor ou só de ícone: visibilidade, papel, lembrete, autoria,
compartilhamento e estado de leitura têm texto próprio no rótulo de
acessibilidade. Etiqueta de visibilidade some em viagem individual — presente em
100% dos itens, não informaria nada.

## Testes

| Suíte | Resultado |
|---|---|
| `npx tsc --noEmit` | ✅ limpo |
| `npx eslint .` | ✅ 0 erros (4 warnings pré-existentes) |
| `npx jest --runInBand` | ✅ **78 suítes, 944 testes** |
| `npx expo-doctor` | ✅ 18/18 |
| `npm run check:functions` | ✅ Edge Functions compilam |
| Migrations 0001→0012 do zero | ✅ |
| Migrations 0008→0012 sobre base com dados legados | ✅ backfill verificado |
| `rls_collaboration.test.sql` | ✅ **62 asserções** |
| `rls_content.test.sql` / `rls_articles.test.sql` | ✅ 28 / 8 — sem regressão |

Testes novos: `collaboration-permissions`, `visibility`, `day-route`,
`reservations`, `reminders`, `suggestions`, `notifications`,
`activity-weather`, `ai-collaboration-privacy`, `collaboration-local`,
`rls_collaboration.test.sql`.

## Pendências conhecidas

1. **OS Push** — arquitetura pronta (reminders + Central); falta
   `expo-notifications`, tabela de tokens, credenciais FCM/APNs e development
   build. Detalhado na seção 30–33.
2. **Cron do briefing** — a Edge Function existe e é idempotente; o
   `cron.schedule` está documentado no cabeçalho e **não** foi aplicado.
3. **Transferência de propriedade** — bloqueada de propósito. Owner não sai
   enquanto houver membros; `set_trip_member_role` recusa `owner`.
4. **Divisão de conta** — fora de escopo por decisão. `paid_by`/`created_by`
   gravados para a evolução futura.
5. **Provedor de rotas** — não existe; distância é Haversine, rotulada como
   linha reta. Trocar por um provedor real muda uma função (`buildDayRoute`) e a
   flag `approximate`.
6. **Arquivo de reserva compartilhada apagada por outro membro** — o objeto fica
   na pasta do criador (a policy de Storage não deixa terceiro removê-lo). Não é
   vazamento: sem a linha `shared`, `can_read_shared_attachment` deixa de casar e
   o arquivo volta a ser alcançável só por quem o enviou.

---

**EASY TRIP COLABORATIVO: CONCLUÍDO.**
Nada foi publicado. `supabase db push`, `functions deploy`, seed remoto,
secrets e `db reset --linked` **não** foram executados.
