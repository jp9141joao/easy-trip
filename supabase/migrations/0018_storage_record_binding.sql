-- Uma referência compartilhada não pode conceder acesso a um upload alheio.
-- 0009 preserva a visibilidade do registro, mas aceitava file_path arbitrário.
-- Não reescreve dados legados nem altera as policies históricas.
create or replace function public.enforce_storage_record_binding()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  expected_parent text;
begin
  -- Manutenção de confiança (migrations/service role), sem sessão de usuário.
  if auth.uid() is null then return new; end if;

  if tg_table_name = 'tickets' then
    if new.file_path is null then return new; end if;
    if tg_op = 'UPDATE' then
      if new.file_path is not distinct from old.file_path
         and new.trip_id = old.trip_id then return new; end if;
    end if;
    expected_parent := new.trip_id::text;
  elsif tg_table_name = 'journal_media' then
    if tg_op = 'UPDATE' then
      if new.file_path is not distinct from old.file_path
         and new.journal_entry_id = old.journal_entry_id then return new; end if;
    end if;
    expected_parent := new.journal_entry_id::text;
  else
    raise exception 'Tabela não suportada.' using errcode = '42501';
  end if;

  if (storage.foldername(new.file_path))[1] is distinct from auth.uid()::text
     or (storage.foldername(new.file_path))[2] is distinct from expected_parent then
    raise exception 'O arquivo deve ser um upload próprio vinculado a este registro.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_storage_record_binding() from public, anon, authenticated;

create trigger tickets_storage_record_binding
before insert or update on public.tickets
for each row execute function public.enforce_storage_record_binding();

create trigger journal_media_storage_record_binding
before insert or update on public.journal_media
for each row execute function public.enforce_storage_record_binding();
