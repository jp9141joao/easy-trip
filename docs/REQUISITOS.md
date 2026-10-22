# Requisitos do Easy Trip

Catálogo dos **74 requisitos funcionais (RF)** e dos **70 requisitos não
funcionais (RNF)** do recorte de avaliação de **2 de setembro de 2026**,
referenciado no TCC (seção 4.1, Tabela 1, e seção 4.2, Quadro 6).

## Origem e natureza deste documento

- Os requisitos foram **recuperados retrospectivamente** a partir do código, das
  telas, do esquema do banco e do comportamento implementado. Não houve
  entrevistas, questionários nem elicitação com usuários.
- A lista de trabalho usada na avaliação de 2/9/2026 **não foi versionada**.
  Este arquivo, redigido em outubro de 2026, redocumenta o catálogo com o mesmo
  método e **preserva os totais e as classificações publicados no TCC**:
  62 RF operantes e 12 dependentes de publicação; para RNF, 58 com evidência
  forte, 7 pendentes de publicação e 5 ausentes ou não verificáveis, com a
  mesma distribuição por categoria.
- A coluna **Código / tabela** aponta o artefato principal em que o requisito
  foi localizado, no estado do repositório em que este arquivo foi publicado.
  Não é uma lista exaustiva de arquivos.
- "Implementado" significa que há código e estrutura de dados localizados. Não
  implica fluxo completo de uso (ver as observações na coluna Situação).

### Situação dos RF

| Situação | Significado |
|---|---|
| **Operante** | Implementado, rastreável e operante sobre o esquema publicado (migration 0012) |
| **Pendente: _X_** | Implementado e rastreável, mas depende da publicação de _X_ (migration ou Edge Function) |

### Recorte avaliado × estado atual

- Em 2/9/2026, o contrato de ações da IA tinha **cinco** tipos
  (`itinerary.add`, `checklist.add`, `expenses.add`, `budget.update`,
  `goal.add`). A ação `journal.add` e a barreira entre pedidos de leitura e de
  escrita (READ×WRITE) foram incorporadas ao ramo `main` depois e não alteram a
  contagem de 74 RF.
- A migration `0018_storage_record_binding.sql` é posterior ao recorte e
  corrige um defeito de vínculo de arquivos; não acrescenta requisito.
- Em consulta somente leitura de 21/09/2026, o Supabase remoto permanecia na
  migration 0012, com quatro das seis Edge Functions publicadas
  (`delete-account` e `send-push` não publicadas). As situações abaixo
  continuam válidas.

---

## Requisitos funcionais

### Autenticação e perfil

| ID | Descrição | Situação | Código / tabela |
|---|---|---|---|
| RF01 | Cadastrar conta com nome, e-mail e senha | Operante | `src/app/(auth)/register.tsx`; `src/providers/AuthProvider.tsx`; `auth.users`, `profiles` (gatilho `handle_new_user`) |
| RF02 | Entrar com e-mail e senha | Operante | `src/app/(auth)/login.tsx`; `src/providers/AuthProvider.tsx` |
| RF03 | Recuperar a senha por e-mail e definir nova senha pelo link recebido | Operante | `src/app/(auth)/forgot-password.tsx`; `src/app/(auth)/reset-password.tsx`; `src/lib/authLinking.ts` |
| RF04 | Sair da conta, com confirmação | Operante | `src/app/profile/settings.tsx`; `src/providers/AuthProvider.tsx` |
| RF05 | Consultar e editar dados pessoais (nome, telefone, país, cidade base, moeda padrão, fuso de origem, estilo de viagem) | Operante | `src/app/profile/index.tsx`; `src/hooks/useProfile.ts`; `profiles` |
| RF06 | Alterar a foto de perfil | Operante | `src/domain/avatar.ts`; `ProfileRepository.replaceAvatar`; bucket privado `avatars` |
| RF07 | Ver estatísticas (viagens, dias viajados, países) e conquistas calculadas a partir das próprias viagens | Operante | `src/app/profile/index.tsx`; `src/domain/selectors.ts`; `trips`, `goals` |
| RF08 | Escolher a aparência do aplicativo (claro, escuro ou sistema) | Operante | `src/app/profile/settings.tsx`; `src/theme/ThemeProvider.tsx`; preferência local |
| RF09 | Excluir a própria conta e os dados pessoais | Pendente: Edge Function `delete-account` | `src/app/profile/settings.tsx`; `supabase/functions/delete-account/` |
| RF10 | Ser impedido de excluir a conta enquanto proprietário de viagem compartilhada, com o motivo nomeado e o caminho indicado | Pendente: migration 0014 | `src/app/profile/settings.tsx`; função `account_deletion_blockers` (`0014_ownership_transfer.sql`) |

### Gestão de viagem

| ID | Descrição | Situação | Código / tabela |
|---|---|---|---|
| RF11 | Criar viagem com destino, país, fuso horário, datas de ida e volta, orçamento total e moeda do orçamento | Operante | `src/app/trips/new.tsx`; `src/hooks/useTrips.ts`; `trips`, `trip_members` (gatilho `handle_new_trip`) |
| RF12 | Listar as viagens acessíveis e filtrá-las por situação (planejadas, em andamento, concluídas) | Operante | `src/app/(tabs)/trips.tsx`; `src/domain/selectors.ts`; `trips` |
| RF13 | Editar e excluir a viagem, ações restritas ao proprietário | Operante | `src/app/trip/[tripId]/edit.tsx`; `trips` (políticas RLS em `0008_trip_collaboration.sql`) |
| RF14 | Calcular a situação e a contagem regressiva da viagem a partir das datas | Operante | `src/domain/selectors.ts`; `src/components/trip/TripStatusChips.tsx` |
| RF15 | Definir imagem de capa personalizada para a viagem | Pendente: migration 0013 | `src/components/trip/TripCoverField.tsx`; `src/domain/tripCover.ts`; `trips.cover_image_path`, bucket `trip-covers` |
| RF16 | Restaurar a imagem padrão da capa | Pendente: migration 0013 | `src/components/trip/TripCoverField.tsx`; `TripRepository.removeCover`; `trips` |
| RF17 | Ver informações do destino (idioma e moeda local) | Operante | `src/components/trip/TripLanguageCard.tsx`; `src/lib/countryMetadata.ts`; `src/lib/countryCurrency.ts` |
| RF18 | Ver painel inicial com a viagem ativa, próximas atividades, orçamento, progresso da preparação e ações rápidas | Operante | `src/app/(tabs)/index.tsx`; `src/providers/TripSelectionProvider.tsx`; `trips`, `itinerary_items`, `expenses`, `checklist_items` |

### Roteiro

| ID | Descrição | Situação | Código / tabela |
|---|---|---|---|
| RF19 | Adicionar, editar e excluir atividades com data, horário de início e fim, tipo, localizador e observações | Operante | `src/app/trip/[tripId]/itinerary.tsx`; `ItineraryRepository`; `itinerary_items` |
| RF20 | Visualizar o roteiro organizado por dia na Jornada | Operante | `src/app/trip/[tripId]/itinerary.tsx`; `src/features/trip/RoteiroModules.tsx` |
| RF21 | Associar local a uma atividade e abrir a rota ("Como chegar") no aplicativo de mapas | Operante | `src/components/trip/LocationPicker.tsx`; `src/components/trip/DayRouteCard.tsx`; `src/domain/route.ts`; `itinerary_items` (coordenadas) |
| RF22 | Ver mapa embarcado com os pontos do roteiro e os lugares do destino | Operante | `src/app/utilities/map.tsx`; `itinerary_items`, `places` |
| RF23 | Ver a previsão do tempo para a data de uma atividade | Operante | `src/components/trip/ActivityWeather.tsx`; `src/services/activityWeather.ts` (Open-Meteo) |

### Lista de preparação

| ID | Descrição | Situação | Código / tabela |
|---|---|---|---|
| RF24 | Adicionar, editar e excluir itens a providenciar, com categoria, prioridade e prazo | Operante | `src/app/trip/[tripId]/checklist.tsx`; `ChecklistRepository`; `checklist_items` |
| RF25 | Marcar itens como resolvidos e acompanhar o progresso da preparação | Operante | `src/app/trip/[tripId]/checklist.tsx`; `src/domain/selectors.ts`; `checklist_items` |

### Finanças e Carteira

| ID | Descrição | Situação | Código / tabela |
|---|---|---|---|
| RF26 | Registrar, editar e excluir despesas com descrição, valor, moeda paga, categoria e data | Operante | `src/app/trip/[tripId]/finance.tsx`; `src/services/expenseWrite.ts`; `expenses` |
| RF27 | Converter a despesa para a moeda do orçamento, gravando valor, taxa e momento da conversão; sem taxa disponível, salvar na moeda original marcada como não convertida | Operante | `src/services/exchangeRates.ts`; `src/services/expenseWrite.ts`; `expenses` |
| RF28 | Ver total gasto, saldo e uso do orçamento | Operante | `src/domain/selectors.ts`; `src/app/trip/[tripId]/finance.tsx` |
| RF29 | Buscar despesas, filtrá-las por categoria e ver o resumo por categoria | Operante | `src/app/trip/[tripId]/finance.tsx`; `src/domain/selectors.ts` |
| RF30 | Definir, editar e remover a meta de gasto diário da viagem | Pendente: migration 0013 | `src/components/trip/DailyGoalCard.tsx`; `trips.daily_spending_goal` |
| RF31 | Acompanhar o gasto diário em relação à meta, com indicação de excesso | Pendente: migration 0013 | `src/components/trip/DailyGoalCard.tsx`; `src/domain/selectors.ts` |
| RF32 | Converter valores avulsos entre a moeda do orçamento e a do destino, quando diferem | Operante | `src/components/trip/CurrencyConverterCard.tsx`; `src/services/currency.ts` |

### Reservas e documentos

| ID | Descrição | Situação | Código / tabela |
|---|---|---|---|
| RF33 | Cadastrar, editar, excluir e filtrar por categoria reservas de voo, hospedagem, carro, ingresso, trem e ônibus, com campos específicos de cada tipo | Operante | `src/app/trip/[tripId]/reservations.tsx`; `src/domain/reservations.ts`; `tickets` (`0011_reservations.sql`) |
| RF34 | Anexar documento ou foto a uma reserva e abri-lo, inclusive sem conexão a partir de cópia local | Operante | `TravelReservationRepository.uploadDocument`; `src/lib/fileMirror.ts`; bucket privado `attachments` |
| RF35 | Configurar lembrete para uma reserva | Operante | `src/components/collaboration/ReminderField.tsx`; `src/domain/reminders.ts`; `reminders`, função `deliver_due_reminders` |

### Diário

| ID | Descrição | Situação | Código / tabela |
|---|---|---|---|
| RF36 | Registrar, editar e excluir anotações do diário com data e local | Operante | `src/app/trip/[tripId]/journal.tsx`; `JournalRepository`; `journal_entries` |
| RF37 | Anexar fotos a uma anotação do diário | Operante | `JournalRepository.addMedia`; `journal_media`, bucket privado `journal` |

### Colaboração

| ID | Descrição | Situação | Código / tabela |
|---|---|---|---|
| RF38 | Convidar viajante por e-mail como editor ou visualizador | Operante | `src/components/collaboration/InviteSheet.tsx`; função `create_trip_invite`; `trip_invites` |
| RF39 | Aceitar ou recusar convite recebido | Operante | `src/app/alerts.tsx`; funções `accept_trip_invite`, `decline_trip_invite` |
| RF40 | Cancelar convite pendente | Operante | `src/app/trip/[tripId]/members.tsx`; função `cancel_trip_invite` |
| RF41 | Listar os viajantes da viagem e seus papéis | Operante | `src/app/trip/[tripId]/members.tsx`; função `trip_member_profiles`; `trip_members` |
| RF42 | Alterar o papel de um participante entre editor e visualizador | Operante | `src/components/collaboration/MemberRow.tsx`; função `set_trip_member_role` |
| RF43 | Remover participante da viagem | Operante | `src/app/trip/[tripId]/members.tsx`; função `remove_trip_member` |
| RF44 | Sair de uma viagem da qual se participa | Operante | `src/app/trip/[tripId]/members.tsx`; função `leave_trip` |
| RF45 | Definir a visibilidade (compartilhado ou privado) de cada item de roteiro, preparação, despesa, diário e reserva | Operante | `src/components/collaboration/VisibilityField.tsx`; `src/domain/visibility.ts`; colunas `visibility`/`created_by` (`0009_trip_visibility.sql`) |
| RF46 | Receber em tempo real as alterações feitas por outros participantes | Operante | `src/hooks/useTripRealtime.ts`; `src/lib/realtimeChannel.ts` |
| RF47 | Transferir a propriedade da viagem a outro viajante | Pendente: migration 0014 | `src/app/trip/[tripId]/members.tsx`; função `transfer_trip_ownership` |
| RF48 | Escolher o novo proprietário apenas entre participantes que já aceitaram o convite | Pendente: migration 0014 | `src/app/trip/[tripId]/members.tsx`; `src/domain/collaboration.ts`; `trip_members` |

### Trabalho fora de rede

| ID | Descrição | Situação | Código / tabela |
|---|---|---|---|
| RF49 | Registrar sem conexão criações, edições e remoções em roteiro, preparação, despesas, diário e metas, em fila durável enviada ao reconectar | Operante | `src/domain/offlineQueue.ts`; `src/lib/offlineQueue.ts`; `src/hooks/useOfflineQueue.ts` |
| RF50 | Consultar as alterações pendentes de envio | Operante | `src/app/profile/sync.tsx`; `src/hooks/useOfflineQueue.ts` |
| RF51 | Tentar novamente o envio de uma alteração pendente | Operante | `src/app/profile/sync.tsx`; `src/services/offlineSync.ts` |
| RF52 | Descartar uma alteração pendente | Operante | `src/app/profile/sync.tsx`; `src/hooks/useOfflineQueue.ts` |
| RF53 | Consultar sem conexão os dados já carregados | Operante | `src/lib/queryPersistence.ts`; `src/providers/QueryPersistence.tsx` |

### Avisos e lembretes

| ID | Descrição | Situação | Código / tabela |
|---|---|---|---|
| RF54 | Ver na central do aplicativo os avisos de todas as viagens acessíveis, com identificação da origem | Operante | `src/app/alerts.tsx`; `src/hooks/useAlerts.ts`; `notifications` |
| RF55 | Marcar avisos como lidos, individualmente ou todos, e removê-los | Operante | `src/app/alerts.tsx`; `NotificationRepository`; `notifications` |
| RF56 | Ligar e desligar as notificações do sistema neste aparelho | Pendente: migration 0016 | `src/hooks/usePushNotifications.ts`; funções `register_push_token`, `unregister_push_token`; `push_tokens` |
| RF57 | Receber avisos por notificação push com o aplicativo fechado (função implementada, mas não acionada pelo sistema) | Pendente: migration 0016 e Edge Function `send-push` | `supabase/functions/send-push/`; `src/services/pushNotifications.ts`; `push_tokens` |
| RF58 | Abrir a viagem correspondente ao tocar na notificação | Pendente: migration 0016 | `src/hooks/usePushNotifications.ts`; `src/lib/deepLink.ts` |

### Assistente de IA

| ID | Descrição | Situação | Código / tabela |
|---|---|---|---|
| RF59 | Conversar com o assistente sobre a viagem, com o contexto montado a partir dos dados que a sessão pode ler | Operante | `src/app/(tabs)/advisor.tsx`; `src/hooks/useAI.ts`; `src/lib/aiTripContext.ts`; `supabase/functions/ai-chat/`; `ai_conversations`, `ai_messages` |
| RF60 | Iniciar nova conversa, apagando a conversa atual | Operante | `src/hooks/useAI.ts`; `AIRepository.deleteConversation`; `ai_conversations` |
| RF61 | Receber do assistente propostas de ações estruturadas, revisá-las e editá-las, e confirmá-las ou cancelá-las antes de qualquer gravação | Operante | `src/domain/aiActions.ts`; `src/components/ai/actions/AIActionReviewSheet.tsx`; `src/services/aiActionExecutor.ts`; `supabase/functions/ai-chat/protocol.ts` |
| RF62 | Ver sugestões de atividades por viagem e adicioná-las ao roteiro escolhendo data e horário, com aviso de item parecido já existente | Operante | `src/app/trip/[tripId]/suggestions.tsx`; `src/domain/suggestions.ts`; `supabase/functions/trip-suggestions/`; `trip_suggestions` |
| RF63 | Atualizar as sugestões com reserva atômica da tentativa, admitindo um único chamador por vez | Pendente: migration 0017 e nova versão da Edge Function `trip-suggestions` | funções `claim_trip_suggestion_refresh`, `settle_trip_suggestion_refresh` (`0017_suggestion_generation_lease.sql`) |
| RF64 | Receber o resumo diário da viagem na central de avisos | Operante | `supabase/functions/trip-daily-briefing/`; `notifications` |

### Utilitários do destino

| ID | Descrição | Situação | Código / tabela |
|---|---|---|---|
| RF65 | Ver a previsão do tempo do destino, com indicação de quando os dados vêm do cache | Operante | `src/app/utilities/weather.tsx`; `src/services/weather.ts` (Open-Meteo) |
| RF66 | Comparar o horário local com o do destino | Operante | `src/app/utilities/timezone.tsx`; `src/services/timezone.ts` |
| RF67 | Ver os números de emergência do país de destino e buscar o consulado brasileiro | Operante | `src/app/utilities/sos.tsx`; `src/services/emergency.ts`; `insurance_policies` (somente leitura) |

### Objetivos pessoais

| ID | Descrição | Situação | Código / tabela |
|---|---|---|---|
| RF68 | Criar, editar e excluir metas de economia, destino, preparação e frequência, com alvo, unidade e prazo | Operante | `src/app/(tabs)/goals.tsx`; `src/hooks/useGoals.ts`; `goals` |
| RF69 | Registrar aportes de progresso e acompanhar a conclusão das metas | Operante | `src/app/(tabs)/goals.tsx`; `goals` |

### Conteúdo editorial, assessoria e administração

| ID | Descrição | Situação | Código / tabela |
|---|---|---|---|
| RF70 | Navegar por ofertas, artigos e lugares com busca e filtros, curtir artigos e favoritar lugares | Operante | `src/app/offers/`, `src/app/community/`, `src/app/places/`; `src/hooks/useContent.ts`; `offers`, `articles`, `places`, `article_likes`, `place_favorites` |
| RF71 | Registrar pedido de reserva em um lugar | Operante (o pedido é armazenado; não há fluxo de atendimento ou confirmação) | `src/app/places/[placeId].tsx`; `src/domain/placeInquiry.ts`; `reservation_requests` |
| RF72 | Consultar o catálogo de especialistas, solicitar consultoria e acompanhar as solicitações | Operante (a solicitação fica com situação "solicitada"; não há fluxo de atendimento ou confirmação) | `src/app/(tabs)/advisor.tsx`; `AdvisorRepository`; `advisors`, `consultations` |
| RF73 | Gerir ofertas, artigos, lugares e especialistas, ação restrita ao papel administrativo | Operante | `src/app/admin/`; `src/hooks/useAdminContent.ts`; função `is_admin` (`0003_admin_roles.sql`) |
| RF74 | Preencher rascunho de conteúdo editorial com IA, para revisão do administrador antes de salvar | Operante | `src/services/adminContent.ts`; `supabase/functions/admin-generate-content/` |

### Síntese dos RF

| Situação | RF | Identificadores |
|---|---:|---|
| Operante | 62 | demais |
| Pendente: migration 0013 | 4 | RF15, RF16, RF30, RF31 |
| Pendente: migration 0014 | 3 | RF10, RF47, RF48 |
| Pendente: Edge Function `delete-account` | 1 | RF09 |
| Pendente: migration 0016 e Edge Function `send-push` | 3 | RF56, RF57, RF58 |
| Pendente: migration 0017 e Edge Function `trip-suggestions` | 1 | RF63 |
| **Total** | **74** | |

---

## Requisitos não funcionais

Classificação pela ISO/IEC 25010:2023. A coluna **Situação** usa as três
classes do Quadro 6 do TCC: **Evidência forte**, **Pendente de publicação**
(forte no código, dependente de publicação) e **Ausente** (ausente ou não
verificável).

### Segurança

| ID | Descrição | Situação | Código / tabela |
|---|---|---|---|
| RNF01 | Todas as tabelas públicas têm segurança em nível de linha (RLS) habilitada | Evidência forte | `supabase/migrations/0002_rls.sql` e seguintes; `supabase/tests/rls_*.test.sql` |
| RNF02 | As políticas autorizam pela identidade do token da sessão (`auth.uid()`), nunca por identificador enviado pelo cliente | Evidência forte | `0002_rls.sql`, `0009_trip_visibility.sql`; gatilho `set_created_by` |
| RNF03 | O aplicativo contém apenas a chave publicável do Supabase; credenciais do Gemini, `service_role` e segredo do agendamento ficam só no servidor | Evidência forte | `src/lib/config.ts`; `supabase/functions/`; `scripts/security-probe.mjs` |
| RNF04 | O papel anônimo não lê nenhuma tabela; sua única leitura é o bucket público de imagens editoriais | Evidência forte | `0005_grants.sql`, `0007_storage_hardening.sql` |
| RNF05 | A escalada para o papel administrativo é bloqueada no banco por papel inicial, privilégios de coluna, gatilho e verificação de papel | Evidência forte | `0003_admin_roles.sql` (`prevent_role_escalation`), `0006_profile_hardening.sql` |
| RNF06 | Participantes e convites não aceitam escrita direta; mutações passam por funções privilegiadas do banco | Evidência forte | `0008_trip_collaboration.sql`, `0010_notifications_reminders.sql`; `trip_members`, `trip_invites` |
| RNF07 | Funções `SECURITY DEFINER` têm `search_path` fixo | Evidência forte | `supabase/migrations/`; `scripts/count-artifacts.sh` |
| RNF08 | Arquivos de usuário ficam em buckets privados, com caminho prefixado pela identidade e acesso por URL assinada | Evidência forte | `0007_storage_hardening.sql`; buckets `avatars`, `attachments`, `journal` |
| RNF09 | A sessão de autenticação é guardada em armazenamento seguro do aparelho | Evidência forte | `src/lib/storage.ts` (`expo-secure-store`) |
| RNF10 | A resposta do modelo de linguagem é tratada como dado não confiável e validada por esquema no servidor, no cliente e no executor | Evidência forte | `supabase/functions/ai-chat/protocol.ts`; `src/domain/aiActions.ts`; `src/services/aiActionExecutor.ts`; `scripts/ai-eval/` |
| RNF11 | As mensagens ao assistente têm limite de taxa por usuário, aplicado no servidor e espelhado no cliente | Evidência forte | `supabase/functions/ai-chat/index.ts`; `src/domain/aiRateLimit.ts` |
| RNF12 | A capa da viagem fica em bucket privado, legível apenas por membros da viagem | Pendente de publicação (0013) | `0013_trip_cover_and_daily_goal.sql` (`trip_cover_trip_id`); bucket `trip-covers` |
| RNF13 | A transferência de propriedade é atômica: não existe estado intermediário com dois proprietários ou nenhum | Pendente de publicação (0014) | `0014_ownership_transfer.sql` (`transfer_trip_ownership`); `supabase/tests/ownership_transfer.test.sql` |
| RNF14 | O segredo do agendamento do resumo diário não é gravado em texto no comando agendado | Pendente de publicação (0015) | `0015_daily_briefing_schedule.sql` (`briefing_secret`); `supabase/tests/briefing_schedule.test.sql` |
| RNF15 | O endereço de entrega de notificação de uma conta é inalcançável por outra | Pendente de publicação (0016) | `0016_push_tokens.sql`; `supabase/tests/push_tokens.test.sql` |

### Privacidade

| ID | Descrição | Situação | Código / tabela |
|---|---|---|---|
| RNF16 | Conteúdo privado de um participante é ilegível, inalterável e não excluível pelos demais, inclusive pelo proprietário | Evidência forte | `0009_trip_visibility.sql`; `supabase/tests/rls_collaboration.test.sql` |
| RNF17 | A visibilidade padrão varia por domínio: roteiro e preparação nascem compartilhados; diário e despesas, privados | Evidência forte | `src/domain/visibility.ts`; `0009_trip_visibility.sql` |
| RNF18 | Anexos e mídia herdam a visibilidade do registro a que pertencem | Evidência forte | `0009_trip_visibility.sql` (`can_read_shared_attachment`, `can_read_shared_journal_media`) |
| RNF19 | O contexto enviado à IA contém apenas dados que a sessão já pode ler; o diário existente não entra no contexto | Evidência forte | `src/lib/aiTripContext.ts`; `src/hooks/useAITripContext.ts` |
| RNF20 | O resumo diário, executado sem sessão de usuário, reaplica a regra de visibilidade para cada destinatário | Evidência forte | `supabase/functions/trip-daily-briefing/index.ts` |
| RNF21 | Ao sair ou ser removido de uma viagem, o conteúdo privado que se torna inalcançável é expurgado | Evidência forte | `0010_notifications_reminders.sql` (`purge_unreachable_private_content`) |
| RNF22 | Ao sair da conta, dados locais da conta (cache, cópias offline de arquivos) são apagados do aparelho | Evidência forte | `src/providers/AuthProvider.tsx`; `DataSource.purgeUserData`; `OfflineFileRepository.purgeLocalCopies` |
| RNF23 | Outros participantes veem apenas o perfil mínimo de cada viajante | Evidência forte | função `trip_member_profiles` (`0008`, `0009`) |
| RNF24 | A exclusão de conta não destrói dados de terceiros | Pendente de publicação (0014 e `delete-account`) | `0014_ownership_transfer.sql`; `supabase/functions/delete-account/`; `supabase/functions/_shared/storagePurge.ts` |
| RNF25 | O texto da notificação push não expõe dado sensível na tela de bloqueio | Pendente de publicação (0016 e `send-push`) | `supabase/functions/send-push/` |
| RNF26 | Política de privacidade própria publicada | Ausente | O item "Política de privacidade" em `src/app/profile/settings.tsx` abre a página da ANPD, não uma política do Easy Trip |
| RNF27 | Política de retenção de dados definida | Ausente | — |

### Confiabilidade

| ID | Descrição | Situação | Código / tabela |
|---|---|---|---|
| RNF28 | A fila de escrita fora de rede sobrevive ao encerramento abrupto do aplicativo | Evidência forte | `src/lib/offlineQueue.ts` (AsyncStorage); `tests/integration/offline-queue-lifecycle.test.ts` |
| RNF29 | O reenvio de uma escrita é idempotente, por identificador gerado no aparelho | Evidência forte | `src/repositories/types.ts` (`WithClientId`); `src/domain/offlineQueue.ts` |
| RNF30 | Conflitos de permissão, exclusão remota ou dado inválido viram pendências visíveis, sem sobrescrita silenciosa | Evidência forte | `src/services/offlineSync.ts`; `src/app/profile/sync.tsx` |
| RNF31 | Com câmbio indisponível, a despesa é salva na moeda original e marcada como não convertida, sem taxa inventada | Evidência forte | `src/services/expenseWrite.ts`; `src/services/exchangeRates.ts` |
| RNF32 | A taxa usada fica gravada na despesa, de modo que um gasto histórico não muda de valor com o mercado | Evidência forte | `src/services/expenseWrite.ts`; `expenses` |
| RNF33 | Valores derivados (situação, contagem regressiva, total, saldo, gasto diário) são calculados, não persistidos, e não podem divergir dos registros | Evidência forte | `src/domain/selectors.ts` |
| RNF34 | Registros operacionais são removidos em cascata com a viagem | Evidência forte | chaves estrangeiras `on delete cascade` em `0001_schema.sql` e seguintes |
| RNF35 | Entradas são validadas por esquema antes da persistência | Evidência forte | `src/domain/schemas.ts` (zod); restrições `CHECK` no esquema |
| RNF36 | Falhas transitórias do provedor de IA acionam modelo alternativo de forma controlada | Evidência forte | `supabase/functions/ai-chat/index.ts` (`maxModels: 2`) |
| RNF37 | A atualização de uma base legada (0001–0007 com dados) até a 0017 preserva os dados | Evidência forte | `scripts/legacy-upgrade-check.sh`; `supabase/tests/legacy_upgrade.test.sql` |

### Manutenibilidade

| ID | Descrição | Situação | Código / tabela |
|---|---|---|---|
| RNF38 | TypeScript em modo estrito no aplicativo e nas Edge Functions | Evidência forte | `tsconfig.json`; `supabase/functions/tsconfig.json` |
| RNF39 | Arquitetura em camadas, com o domínio isolado de React e React Native | Evidência forte | `src/domain/` |
| RNF40 | Padrão Repository desacopla as telas da persistência, com fontes local e Supabase intercambiáveis | Evidência forte | `src/repositories/types.ts`; `src/repositories/local/`; `src/repositories/supabase/` |
| RNF41 | O esquema evolui por migrations sequenciais e imutáveis, que verificam a materialização dos objetos e privilégios esperados | Evidência forte | `supabase/migrations/`; `scripts/sql-test.sh` |
| RNF42 | Suítes automatizadas versionadas em três camadas (Jest, SQL e ponta a ponta) | Evidência forte | `tests/`; `supabase/tests/`; `scripts/e2e/` |
| RNF43 | Análise estática sem erros | Evidência forte | `eslint.config.js` |
| RNF44 | Verificação contínua a cada alteração proposta | Evidência forte | `.github/workflows/ci.yml`; `.github/workflows/e2e.yml` |
| RNF45 | Publicação apenas por acionamento manual, sujeita a regressão completa e aprovação humana | Evidência forte | `.github/workflows/deploy.yml` |
| RNF46 | Mudança de esquema e de função publicadas em ordem compatível (migration 0017 antes da nova `trip-suggestions`) | Pendente de publicação (0017) | `0017_suggestion_generation_lease.sql`; `supabase/functions/trip-suggestions/`; `src/repositories/backendCapabilities.ts` |
| RNF47 | Monitoração de execução em produção | Ausente | — |

### Usabilidade

| ID | Descrição | Situação | Código / tabela |
|---|---|---|---|
| RNF48 | Interface em português, com datas e valores formatados conforme a localidade | Evidência forte | `src/lib/locale.ts`; `src/lib/date.ts`; `src/lib/currency.ts` |
| RNF49 | Estados vazios, de carregamento e de erro com orientação e ação de recuperação | Evidência forte | `src/components/ui/Feedback.tsx` (`EmptyState`, `ErrorState`, `Skeleton`) |
| RNF50 | Ações destrutivas exigem confirmação | Evidência forte | `src/components/ui/Overlay.tsx` (`ConfirmDialog`) |
| RNF51 | A interface não afirma o que não pode garantir: dado em cache, número não validado e solicitação aguardando confirmação são rotulados como tal | Evidência forte | `src/app/utilities/weather.tsx`; `src/app/utilities/sos.tsx`; `src/app/places/[placeId].tsx` |
| RNF52 | Tema claro, escuro ou do sistema | Evidência forte | `src/theme/` |
| RNF53 | O modo local de demonstração é identificado na interface, com suas limitações | Evidência forte | `src/app/profile/settings.tsx`; `src/app/(tabs)/advisor.tsx` |

### Acessibilidade

| ID | Descrição | Situação | Código / tabela |
|---|---|---|---|
| RNF54 | Controles interativos têm rótulo acessível para leitores de tela | Evidência forte | `accessibilityLabel` em `src/components/` e `src/app/` |
| RNF55 | Elementos interativos declaram papel acessível | Evidência forte | `accessibilityRole` em `src/components/ui/` |
| RNF56 | Alvos de toque com área mínima | Evidência forte | `src/components/ui/Button.tsx` e demais componentes (`minHeight`, `hitSlop`) |
| RNF57 | Contraste garantido sobre fotografias e superfícies nos temas claro e escuro | Evidência forte | `src/theme/theme.ts`; `src/theme/tokens.ts` |
| RNF58 | Verificação automatizada de acessibilidade | Ausente | — |

### Desempenho

| ID | Descrição | Situação | Código / tabela |
|---|---|---|---|
| RNF59 | Cache de consultas persistido no aparelho para exibição imediata ao abrir | Evidência forte | `src/lib/queryPersistence.ts`; `src/providers/QueryPersistence.tsx` |
| RNF60 | Listas longas renderizadas de forma virtualizada | Evidência forte | `FlatList`/`SectionList` nas telas de listagem |
| RNF61 | Colunas de chave estrangeira e de filtro indexadas | Evidência forte | índices em `supabase/migrations/` (61 no esquema medido) |
| RNF62 | Respostas de clima e câmbio reaproveitadas de cache, reduzindo chamadas externas | Evidência forte | `src/services/weather.ts`; `src/services/exchangeRates.ts` |
| RNF63 | Medição de desempenho reprodutível para domínio e backend local, com aquecimento descartado, N declarado, média, mediana e p95 (sem medição em aparelho) | Evidência forte | `scripts/benchmark.mjs` |

### Disponibilidade

| ID | Descrição | Situação | Código / tabela |
|---|---|---|---|
| RNF64 | O aplicativo funciona sem backend configurado, com persistência local | Evidência forte | `src/repositories/local/LocalDataSource.ts` |
| RNF65 | O câmbio usa provedor alternativo quando o principal falha | Evidência forte | `src/services/exchangeRates.ts` (Frankfurter → ExchangeRate-API) |
| RNF66 | Leitura e escrita continuam possíveis sem conexão, por cache persistido e fila durável | Evidência forte | `src/lib/queryPersistence.ts`; `src/lib/offlineQueue.ts` |
| RNF67 | Monitoração de execução com acordo de nível de serviço | Ausente | — |

### Portabilidade

| ID | Descrição | Situação | Código / tabela |
|---|---|---|---|
| RNF68 | Executa em Android e iOS pelo Expo Go, sem módulo nativo fora do que ele embarca | Evidência forte | `app.json`; `package.json` |
| RNF69 | A mesma base de código opera com fonte local ou Supabase sem alteração das telas | Evidência forte | `src/repositories/index.ts` (`DataSource`) |
| RNF70 | O banco é reproduzível em qualquer instância PostgreSQL 17 pela aplicação sequencial das migrations | Evidência forte | `scripts/sql-test.sh`; `scripts/count-artifacts.sh` |

### Síntese dos RNF

| Categoria | RNF | Evidência forte | Pendente de publicação | Ausente |
|---|---:|---:|---:|---:|
| Segurança | 15 | 11 | 4 | 0 |
| Privacidade | 12 | 8 | 2 | 2 |
| Confiabilidade | 10 | 10 | 0 | 0 |
| Manutenibilidade | 10 | 8 | 1 | 1 |
| Usabilidade | 6 | 6 | 0 | 0 |
| Acessibilidade | 5 | 4 | 0 | 1 |
| Desempenho | 5 | 5 | 0 | 0 |
| Disponibilidade | 4 | 3 | 0 | 1 |
| Portabilidade | 3 | 3 | 0 | 0 |
| **Total** | **70** | **58** | **7** | **5** |
