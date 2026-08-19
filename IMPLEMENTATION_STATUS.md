# Easy Trip 2.0 — status de implementação

Registro do que foi construído, das decisões tomadas e do que ficou fora do
escopo desta entrega (§121).

**Estado atual:** aplicativo executável no Expo Go, TypeScript `strict` sem
erros, ESLint sem problemas, 73 testes passando, bundles Android e iOS gerados
com sucesso, e nenhum segredo no bundle.

---

## Verificações executadas

| Verificação | Comando | Resultado |
| --- | --- | --- |
| TypeScript | `npm run typecheck` | 0 erros |
| Lint | `npm run lint` | 0 problemas |
| Testes | `npm test` | 73/73 |
| Bundle Android | `expo export --platform android` | 7,4 MB, sucesso |
| Bundle iOS | `expo export --platform ios` | 7,1 MB, sucesso |
| Segredos no bundle | grep no `.hbc` | 0 ocorrências |
| Rotas × navegação | auditoria de `router.push/replace` | todos os alvos existem |

---

## Fases concluídas

| Fase | Escopo | Situação |
| --- | --- | --- |
| 1 | Fundação Expo, Router, aliases, tema, fontes, Safe Area | concluída |
| 2 | Design system (tokens + ~40 componentes) | concluída |
| 3 | Auth (local e Supabase), sessão, rotas protegidas | concluída |
| 4 | Modelo Trip, schemas, repositories, RLS, `currentTripId` | concluída |
| 5 | CRUD de viagens + seleção da viagem ativa | concluída |
| 6 | Trip Hub, abas e navegação profunda | concluída |
| 7 | Roteiro + Checklist | concluída |
| 8 | Carteira, despesas, totais derivados, câmbio real | concluída |
| 9 | Tickets + Diário com upload real | concluída |
| 10 | Metas + Perfil com estatísticas derivadas | concluída |
| 11 | Dashboard com dados reais | concluída |
| 12 | Ofertas, Comunidade, Places | concluída |
| 13 | Clima, Fuso, Câmbio, SOS | concluída |
| 14 | Mapa (`react-native-maps`, real) | concluída |
| 15 | Gemini via BFF + modo local rotulado | concluída |
| 16 | Assessoria + solicitação de reserva | concluída |
| 17 | Offline (cache, banner, invalidação ao reconectar) | parcial — ver abaixo |
| 18 | Acessibilidade e performance | concluída |
| 19 | Testes unitários e de integração | concluída (E2E fora do escopo) |
| 20 | Polimento e conteúdo | concluída |

---

## Telas implementadas (34 arquivos de rota)

**Auth** login · cadastro · recuperação de senha
**Principais** Dashboard · Viagens · Objetivos · Assessoria (Especialistas + IA)
**Viagem** Trip Hub · Jornada · Checklist · Diário · Carteira · Tickets · Editar
**Descoberta** Ofertas · Detalhe da oferta · Comunidade · Artigo · Places · Detalhe do lugar
**Utilidades** Clima · Fuso horário · Mapa · SOS
**Conta** Perfil · Configurações
**Outros** Splash/boot · Onboarding · Central de alertas · Nova viagem

Editores (atividade, checklist, despesa, ticket, diário, meta, consultoria,
reserva) são bottom sheets dentro das telas, conforme §79 — evitando a
dependência de biblioteca de sheet incompatível com Expo Go.

---

## Bugs do protótipo que não foram reproduzidos (§100)

Cada item abaixo tem defesa estrutural, não apenas cuidado manual:

| Bug original | Defesa |
| --- | --- |
| Paris com dados de Kyoto | só existe `currentTripId`; todo dado é lido por `tripId` da rota |
| `daysLeft` aleatório | `getDaysUntilTrip()` — testado |
| status hardcoded | `getTripStatus()` derivado de datas — testado |
| saldo mutável separado das despesas | `remaining = budget − Σ despesas`, sem coluna paralela |
| saldo clampado em zero | valores negativos são exibidos com `- R$` — testado |
| taxa fixa anunciada como tempo real | Frankfurter real; sem cotação ⇒ "Cotação indisponível" |
| Gemini hardcoded | Gemini real via BFF; sem BFF, resposta local **rotulada** |
| chave Gemini exposta | verificado por grep no bundle: ausente |
| clima Paris fixo | Open-Meteo pelas coordenadas da viagem ativa |
| SOS 190/192 universal | resolvido por `countryCode`, com fonte e data de verificação |
| save falso no perfil | escrita real + teste de persistência |
| reserva falsa | status nasce `requested`; UI diz "aguardando confirmação" |
| mapa estático | `react-native-maps` real, embarcado no Expo Go |
| favoritos/likes temporários | persistidos por usuário, com teste |
| stats hardcoded | `getTravelStats()` derivado — testado |
| botões sem ação | anexo indisponível vira aviso, não botão morto |

---

## Decisões de arquitetura

1. **`src/app/` em vez de `app/` na raiz.** É a convenção do template oficial do
   SDK 57. A árvore de rotas é idêntica à do §10.
2. **Editores como bottom sheets**, não rotas `modal/*`. §79 orienta usar
   primitives quando a biblioteca quebraria o Expo Go; o fluxo do usuário é o
   mesmo.
3. **Clima, câmbio e geocodificação chamam APIs sem chave diretamente.** Não
   precisam de BFF porque não há segredo a proteger — o que os torna
   genuinamente reais mesmo no modo demonstração. Só o Gemini exige o BFF.
4. **Dataset de emergência embarcado, não buscado.** SOS precisa funcionar sem
   rede. São ~55 países com fonte e data; fora disso, o app admite que não sabe.
5. **Auth local no modo demonstração.** Sem backend não existe provedor de
   identidade. As senhas são salgadas e hasheadas, e a UI declara que o modo é
   local — não se apresenta como segurança de produção.
6. **Anexos como caminho + URL assinada** no Supabase; buckets privados.

---

## Limitações conhecidas

| Item | Situação | Observação |
| --- | --- | --- |
| Testes E2E (§103) | não implementados | §103 permite Maestro como ferramenta externa; os fluxos estão cobertos por testes de integração no nível de repositório |
| Fila de mutações offline (§20) | parcial | há cache, banner de offline e invalidação ao reconectar; escrita offline enfileirada não foi implementada — as mutações falham com mensagem clara em vez de fingir sucesso |
| Notificações push | fora do escopo | §7 não inclui no core |
| `ARS` no câmbio | sem cotação | o BCE não publica; o app marca a despesa como não convertida |
| Avaliações de usuários em Places | ausentes | §52 proíbe exibir reviews fictícias; a tela declara isso |
| Telefones de consulado | ausentes | sem fonte validada; a tela oferece busca oficial |
| Seed do Supabase | manual | `npm run seed:generate` + `psql` |

---

## Contratos que não devem ser alterados sem motivo

- `Trip` e a regra de que **valores derivados não são persistidos**;
- a interface `DataSource` (`src/repositories/types.ts`) — é o que permite
  trocar local ↔ Supabase sem tocar em tela;
- `src/domain/selectors.ts` — é a única fonte de dados derivados, e é testada;
- o fluxo `Expo → BFF → Gemini`, que mantém o segredo fora do bundle.

---

## Próximos passos sugeridos

1. Fila de mutações offline com reconciliação ao reconectar.
2. Suíte E2E em Maestro cobrindo os fluxos do §103.
3. Provedor de Places real (Google/Foursquare) atrás do `PlaceRepository`.
4. Observabilidade (Sentry) para os erros já registrados no console.
5. Ampliar o dataset de emergência e automatizar sua revisão periódica.
