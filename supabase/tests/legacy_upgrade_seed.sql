-- =============================================================================
-- Parte 1 do cenário de upgrade: os dados que já existiam sob o schema 0007.
--
-- Aplicado ANTES de 0008–0012. Nada aqui menciona `visibility`, `created_by`,
-- `paid_by`, `status` ou `trip_members` — essas colunas ainda não existem, e é
-- exatamente essa a situação de quem está em produção hoje.
-- =============================================================================

\set ON_ERROR_STOP on
\set QUIET on

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'legado@easytrip.app')
on conflict (id) do nothing;

insert into public.trips
  (id, user_id, destination_city, destination_country, country_code, timezone,
   start_date, end_date, budget_total, budget_currency)
values
  ('aa000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-00000000000a',
   'Paris', 'França', 'FR', 'Europe/Paris', '2026-09-01', '2026-09-08', 5000, 'BRL')
on conflict (id) do nothing;

insert into public.itinerary_items
  (id, trip_id, date, type, title, place_name, sort_order)
values
  ('ab000000-0000-4000-8000-00000000000b', 'aa000000-0000-4000-8000-00000000000a',
   '2026-09-02', 'atracao', 'Museu do Louvre', 'Louvre', 0)
on conflict (id) do nothing;

insert into public.checklist_items (id, trip_id, label, category)
values
  ('ac000000-0000-4000-8000-00000000000c', 'aa000000-0000-4000-8000-00000000000a',
   'Passaporte', 'documentos')
on conflict (id) do nothing;

insert into public.expenses
  (id, trip_id, user_id, category, amount, currency, transaction_date, description)
values
  ('ad000000-0000-4000-8000-00000000000d', 'aa000000-0000-4000-8000-00000000000a',
   'a0000000-0000-4000-8000-00000000000a', 'alimentacao', 250.50, 'BRL',
   '2026-09-02', 'Jantar')
on conflict (id) do nothing;

insert into public.journal_entries (id, trip_id, user_id, entry_date, content)
values
  ('ae000000-0000-4000-8000-00000000000e', 'aa000000-0000-4000-8000-00000000000a',
   'a0000000-0000-4000-8000-00000000000a', '2026-09-02', 'Primeiro dia em Paris.')
on conflict (id) do nothing;

insert into public.journal_media (id, journal_entry_id, file_path, mime_type, sort_order)
values
  ('af000000-0000-4000-8000-00000000000f', 'ae000000-0000-4000-8000-00000000000e',
   'a0000000-0000-4000-8000-00000000000a/ae000000-0000-4000-8000-00000000000e/foto.jpg',
   'image/jpeg', 0)
on conflict (id) do nothing;

-- Os dois tipos legados que a 0011 normaliza, para medir `legacy_type`.
insert into public.tickets
  (id, trip_id, user_id, type, title, provider, reference, file_path, mime_type)
values
  ('b1000000-0000-4000-8000-000000000011', 'aa000000-0000-4000-8000-00000000000a',
   'a0000000-0000-4000-8000-00000000000a', 'voo', 'TAP 1234', 'TAP', 'ABC123',
   'a0000000-0000-4000-8000-00000000000a/aa000000-0000-4000-8000-00000000000a/bilhete.pdf',
   'application/pdf'),
  ('b2000000-0000-4000-8000-000000000022', 'aa000000-0000-4000-8000-00000000000a',
   'a0000000-0000-4000-8000-00000000000a', 'hospedagem', 'Hotel Le Marais', 'Le Marais', 'HTL9', null, null)
on conflict (id) do nothing;
