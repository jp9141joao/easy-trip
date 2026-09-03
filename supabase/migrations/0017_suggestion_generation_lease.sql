-- =============================================================================
-- Easy Trip — a janela de geração de sugestões deixa de ser gasta por uma
-- tentativa que não entregou nada (§43)
--
-- O QUE A 0012 FEZ, E POR QUE ESTAVA CERTA PELA METADE
--
-- `claim_trip_suggestion_refresh` gravava `suggestions_refreshed_at = now()`
-- ANTES do Gemini. Isso é obrigatório: a marca d'água é o que impede dois
-- aparelhos de lerem "livre" ao mesmo tempo e chamarem o provedor em paralelo,
-- e ela precisa ser gravada antes da chamada porque é justamente a chamada que
-- se quer proteger.
--
-- O efeito colateral era que a marca d'água significava duas coisas ao mesmo
-- tempo: "há uma tentativa em curso" e "esta viagem foi atualizada". Uma
-- tentativa que falhava no provedor deixava a segunda afirmação gravada sem que
-- ela fosse verdade — e a viagem ficava seis horas sem sugestão nenhuma e sem
-- botão que funcionasse. Foi o caso de Moscovo.
--
-- O QUE MUDA
--
-- As duas afirmações passam a ser colunas diferentes:
--
--   · `suggestions_attempt_key` / `suggestions_attempt_at` — há uma tentativa
--     em curso, e desde quando. É o que exclui a segunda chamada simultânea.
--   · `suggestions_refreshed_at` — a última tentativa que ENTREGOU. É o que
--     abre a janela de seis horas, e só é gravada no fim, quando já se sabe o
--     resultado.
--   · `suggestions_retry_after` — quando uma tentativa que não entregou nada
--     poderá ser repetida. Minutos, não horas.
--   · `suggestions_failed_attempts` — quantas falharam em sequência, para o
--     cooldown crescer e um destino que falha sempre não virar um laço de
--     custo.
--
-- POR QUE UM TOKEN, E POR QUE ELE NÃO É GRAVADO EM CLARO
--
-- Quem termina a tentativa precisa provar que é dono dela. Sem isso,
-- `settle(...)` viraria exatamente o "release" que a 0012 recusou a criar: um
-- cliente modificado geraria com sucesso, desfaria a própria janela e repetiria
-- sem teto.
--
-- O token é um uuid devolvido SOMENTE a quem venceu o claim. A linha guarda
-- `md5(token)`. `public.trips` é legível por qualquer membro da viagem — um
-- token guardado em claro seria lido por um `select *` e o dono deixaria de ser
-- prova de nada.
--
-- O QUE UM CLIENTE MODIFICADO AINDA CONSEGUE, E POR QUE ISSO É ACEITÁVEL
--
-- Chamar `claim` direto e terminar a própria tentativa. Todos os caminhos são
-- contra ele mesmo: `delivered` grava a marca d'água e o tranca por seis horas;
-- `retry` incrementa a contagem de falhas e ADIA a próxima tentativa. Não
-- existe combinação que devolva a janela sem custo. O teto de gasto continua
-- sendo uma chamada ao provedor por viagem a cada cooldown, e o cooldown dobra
-- a cada falha até bater nas mesmas seis horas de antes.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Colunas
--
-- Nenhuma delas é concedida a `authenticated` no `grant update` da 0012 — e é
-- por isso que o `grant` de lá enumera colunas em vez de conceder a tabela.
-- Coluna nova nasce sem privilégio de escrita para o aplicativo: quem escreve é
-- só o par claim/settle, que roda `security definer` e confere o papel.
-- ----------------------------------------------------------------------------
alter table public.trips
  add column if not exists suggestions_attempt_key      text,
  add column if not exists suggestions_attempt_at       timestamptz,
  add column if not exists suggestions_retry_after      timestamptz,
  add column if not exists suggestions_failed_attempts  integer not null default 0;

comment on column public.trips.suggestions_attempt_key is
  'md5 do token da tentativa em curso. Nunca o token em claro: a linha é legível por membros.';
comment on column public.trips.suggestions_attempt_at is
  'Início da tentativa em curso. Depois da lease ela é considerada abandonada e pode ser retomada.';
comment on column public.trips.suggestions_refreshed_at is
  'Última tentativa que ENTREGOU sugestões. Abre a janela de 6h; não é mais gravada no claim.';
comment on column public.trips.suggestions_retry_after is
  'Quando uma tentativa que não entregou nada pode ser repetida. Minutos, não horas.';
comment on column public.trips.suggestions_failed_attempts is
  'Falhas consecutivas sem entrega. Zera na primeira entrega; faz o cooldown dobrar até 6h.';

-- ----------------------------------------------------------------------------
-- 2. Os números, em um lugar só
--
-- Três constantes, três funções. Espalhá-las pelo corpo do claim e do settle
-- garantiria que um dia elas divergissem — e a diferença entre "janela de
-- sucesso" e "cooldown de falha" é exatamente o que esta migration existe para
-- manter separado.
-- ----------------------------------------------------------------------------

/*
 * A janela do SUCESSO. Inalterada desde a 0012: seis horas.
 */
create or replace function public.suggestion_refresh_interval()
returns interval language sql immutable as $$ select interval '6 hours' $$;

/*
 * A lease de uma tentativa em curso.
 *
 * A Edge Function pode morrer entre o claim e o settle — deploy, timeout do
 * runtime, queda de rede na volta. Sem lease, essa tentativa seguraria a
 * viagem para sempre; com ela, o pior caso de uma função que sumiu é cinco
 * minutos, e não seis horas.
 *
 * Cinco minutos e não trinta segundos: o pior caso legítimo são duas chamadas
 * ao Gemini em sequência, e encurtar a lease abaixo disso liberaria uma segunda
 * chamada enquanto a primeira ainda está viva — que é precisamente o custo
 * duplicado que o claim existe para impedir.
 */
create or replace function public.suggestion_attempt_lease()
returns interval language sql immutable as $$ select interval '5 minutes' $$;

/*
 * O cooldown da FALHA — o número que esta migration acrescenta.
 *
 * Dez minutos na primeira falha, dobrando a cada falha consecutiva, até bater
 * nas seis horas da janela normal. Não é um retry imediato e ilimitado: uma
 * viagem cujo destino o modelo não cobre sai de dez minutos para vinte, quarenta,
 * e em seis tentativas está de volta ao teto antigo — sem nunca ter prendido a
 * pessoa por seis horas por causa da PRIMEIRA falha.
 */
create or replace function public.suggestion_failure_cooldown(consecutive_failures integer)
returns interval language sql immutable as $$
  select least(
    interval '10 minutes' * power(2, least(greatest(consecutive_failures, 1) - 1, 6)),
    public.suggestion_refresh_interval()
  )
$$;

comment on function public.suggestion_failure_cooldown(integer) is
  'Cooldown de falha: 10 min dobrando por falha consecutiva, com teto na janela de 6h.';

-- ----------------------------------------------------------------------------
-- 3. Claim
--
-- Continua sendo UM update com predicado — é isso que o torna atômico. Sob
-- concorrência o PostgreSQL trava a linha e REAVALIA o predicado depois do
-- lock: a segunda chamada vê a tentativa que a primeira acabou de registrar e
-- volta com `claimed = false`. Não há leitura seguida de escrita, que é onde
-- caberia a corrida.
--
-- A assinatura muda (passa a devolver o token e o `retry_after`), e por isso a
-- função é derrubada antes: `create or replace` não troca a lista de colunas de
-- retorno.
-- ----------------------------------------------------------------------------
drop function if exists public.claim_trip_suggestion_refresh(uuid);

create or replace function public.claim_trip_suggestion_refresh(target_trip uuid)
returns table (
  claimed      boolean,
  attempt      uuid,
  refreshed_at timestamptz,
  retry_after  timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  token uuid := gen_random_uuid();
  marca timestamptz;
  espera timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Sessão obrigatória.' using errcode = '42501';
  end if;

  if not public.can_edit_trip(target_trip) then
    raise exception 'Sem permissão para atualizar sugestões desta viagem.' using errcode = '42501';
  end if;

  update public.trips t
     set suggestions_attempt_key = md5(token::text),
         suggestions_attempt_at  = now()
   where t.id = target_trip
     -- (a) ninguém está gerando agora — ou quem estava abandonou a tentativa.
     and (
       t.suggestions_attempt_key is null
       or t.suggestions_attempt_at is null
       or t.suggestions_attempt_at <= now() - public.suggestion_attempt_lease()
     )
     -- (b) a janela de seis horas da última ENTREGA está aberta.
     and (
       t.suggestions_refreshed_at is null
       or t.suggestions_refreshed_at <= now() - public.suggestion_refresh_interval()
     )
     -- (c) o cooldown da última falha já passou.
     and (
       t.suggestions_retry_after is null
       or t.suggestions_retry_after <= now()
     )
  returning t.suggestions_refreshed_at, t.suggestions_retry_after
       into marca, espera;

  if found then
    -- O token sai daqui e não é gravado em lugar nenhum em claro. Quem o
    -- perder perde a tentativa: ela expira sozinha com a lease.
    return query select true, token, marca, espera;
    return;
  end if;

  select t.suggestions_refreshed_at, t.suggestions_retry_after
    into marca, espera
    from public.trips t
   where t.id = target_trip;

  return query select false, null::uuid, marca, espera;
end;
$$;

comment on function public.claim_trip_suggestion_refresh(uuid) is
  'CAS antes da geração: devolve um token de tentativa a um único chamador. Não grava marca d''água.';

revoke all on function public.claim_trip_suggestion_refresh(uuid) from public, anon;
grant execute on function public.claim_trip_suggestion_refresh(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. Settle
--
-- O veredito da tentativa, e o único lugar em que a marca d'água de seis horas
-- é gravada.
--
--   `delivered` — a tentativa entregou pelo menos uma sugestão (inclusive a
--                 entrega parcial, abaixo do mínimo: o custo do provedor foi
--                 pago e o conteúdo existe). Janela de 6h; contagem de falhas
--                 zerada.
--   `exhausted` — falha determinística: chave ausente, payload recusado,
--                 schema inválido. Repetir em dez minutos gastaria de novo com
--                 a mesma certeza de falhar, então consome a janela como uma
--                 entrega consumiria. É o que impede o retry infinito.
--   `retry`     — falha transitória ou zero sugestão útil. A marca d'água NÃO é
--                 tocada: a janela de seis horas continua sendo da última
--                 entrega de verdade. O que se grava é o cooldown curto.
--
-- Um `update` só, com o token no predicado. Um token que não é o da tentativa
-- em curso não casa e a chamada não faz nada — é assim que a tentativa que
-- perdeu a lease para outra deixa de poder terminar a viagem de quem a
-- substituiu.
-- ----------------------------------------------------------------------------
create or replace function public.settle_trip_suggestion_refresh(
  target_trip uuid,
  attempt     uuid,
  outcome     text
)
returns table (
  settled      boolean,
  refreshed_at timestamptz,
  retry_after  timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  marca timestamptz;
  espera timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Sessão obrigatória.' using errcode = '42501';
  end if;

  if not public.can_edit_trip(target_trip) then
    raise exception 'Sem permissão para atualizar sugestões desta viagem.' using errcode = '42501';
  end if;

  if outcome is null or outcome not in ('delivered', 'exhausted', 'retry') then
    raise exception 'Resultado de geração desconhecido.' using errcode = '22023';
  end if;

  update public.trips t
     set suggestions_attempt_key = null,
         suggestions_attempt_at  = null,
         suggestions_refreshed_at = case
           when outcome in ('delivered', 'exhausted') then now()
           else t.suggestions_refreshed_at
         end,
         suggestions_failed_attempts = case
           when outcome = 'delivered' then 0
           when outcome = 'retry' then t.suggestions_failed_attempts + 1
           else t.suggestions_failed_attempts
         end,
         suggestions_retry_after = case
           when outcome = 'retry'
             then now() + public.suggestion_failure_cooldown(t.suggestions_failed_attempts + 1)
           else null
         end
   where t.id = target_trip
     and attempt is not null
     and t.suggestions_attempt_key is not null
     and t.suggestions_attempt_key = md5(attempt::text)
  returning t.suggestions_refreshed_at, t.suggestions_retry_after
       into marca, espera;

  if found then
    return query select true, marca, espera;
    return;
  end if;

  -- Token velho, tentativa já encerrada ou retomada por outra: nada muda, e o
  -- chamador recebe o estado atual em vez de um erro. Insistir aqui só
  -- transformaria uma corrida perdida — que é normal — em falha de tela.
  select t.suggestions_refreshed_at, t.suggestions_retry_after
    into marca, espera
    from public.trips t
   where t.id = target_trip;

  return query select false, marca, espera;
end;
$$;

comment on function public.settle_trip_suggestion_refresh(uuid, uuid, text) is
  'Encerra a tentativa: delivered/exhausted gravam a janela de 6h; retry grava só o cooldown curto.';

revoke all on function public.settle_trip_suggestion_refresh(uuid, uuid, text) from public, anon;
grant execute on function public.settle_trip_suggestion_refresh(uuid, uuid, text) to authenticated, service_role;
