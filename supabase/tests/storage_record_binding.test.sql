-- Referências forjadas não podem transformar um arquivo privado em compartilhado.
\set ON_ERROR_STOP on
begin;

create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if ok then raise notice '  OK   %', label;
  else raise exception 'FALHOU: %', label; end if;
end;
$$;
create function pg_temp.deny(command text, label text) returns void language plpgsql as $$
begin
  execute command;
  raise exception 'FALHOU: %', label;
exception when insufficient_privilege then raise notice '  OK   %', label;
end;
$$;

insert into auth.users (id, email) values
 ('0a000000-0000-4000-8000-00000000000a', 'binding-a@example.test'),
 ('0b000000-0000-4000-8000-00000000000b', 'binding-b@example.test');
insert into public.trips (id,user_id,destination_city,destination_country,country_code,timezone,start_date,end_date,budget_currency)
values ('a1000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-00000000000a','Paris','França','FR','Europe/Paris','2026-09-01','2026-09-10','BRL');
insert into public.trip_members(trip_id,user_id,role)
values ('a1000000-0000-4000-8000-000000000001','0b000000-0000-4000-8000-00000000000b','editor');
insert into public.journal_entries(id,trip_id,user_id,entry_date,content,visibility,created_by) values
 ('c2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-00000000000a','2026-09-01','Compartilhado','shared','0a000000-0000-4000-8000-00000000000a'),
 ('c2000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000001','0b000000-0000-4000-8000-00000000000b','2026-09-01','Privado','private','0b000000-0000-4000-8000-00000000000b');
insert into storage.objects(bucket_id,name) values
 ('attachments','0b000000-0000-4000-8000-00000000000b/a1000000-0000-4000-8000-000000000001/private.pdf'),
 ('journal','0b000000-0000-4000-8000-00000000000b/c2000000-0000-4000-8000-000000000002/private.jpg');

set local role authenticated;
set local request.jwt.claims = '{"sub":"0a000000-0000-4000-8000-00000000000a"}';
select pg_temp.check((select count(*) from storage.objects)=0, 'proprietário não lê arquivos privados do editor');
select pg_temp.deny($cmd$
 insert into public.tickets(trip_id,user_id,type,title,visibility,file_path) values
 ('a1000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-00000000000a','flight','Referência forjada','shared',
 '0b000000-0000-4000-8000-00000000000b/a1000000-0000-4000-8000-000000000001/private.pdf')
$cmd$, 'INSERT não publica anexo de outro usuário');
select pg_temp.deny($cmd$
 insert into public.journal_media(journal_entry_id,file_path,mime_type) values
 ('c2000000-0000-4000-8000-000000000001','0b000000-0000-4000-8000-00000000000b/c2000000-0000-4000-8000-000000000002/private.jpg','image/jpeg')
$cmd$, 'INSERT não publica mídia de diário privado de outro usuário');

insert into public.tickets(id,trip_id,user_id,type,title,visibility,file_path) values
 ('c3000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-00000000000a','flight','Anexo próprio','shared',
 '0a000000-0000-4000-8000-00000000000a/a1000000-0000-4000-8000-000000000001/own.pdf');
select pg_temp.check(exists(select 1 from public.tickets where title='Anexo próprio'), 'anexo próprio continua permitido');
select pg_temp.deny($cmd$
 update public.tickets set file_path='0b000000-0000-4000-8000-00000000000b/a1000000-0000-4000-8000-000000000001/private.pdf'
 where id='c3000000-0000-4000-8000-000000000001'
$cmd$, 'UPDATE não publica anexo alheio');
select pg_temp.deny($cmd$
 update public.tickets set file_path='0a000000-0000-4000-8000-00000000000a/a1000000-0000-4000-8000-000000000002/own.pdf'
 where id='c3000000-0000-4000-8000-000000000001'
$cmd$, 'anexo não atravessa viagens');
insert into public.journal_media(id,journal_entry_id,file_path,mime_type) values
 ('c4000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001',
 '0a000000-0000-4000-8000-00000000000a/c2000000-0000-4000-8000-000000000001/own.jpg','image/jpeg');
select pg_temp.deny($cmd$
 update public.journal_media set file_path='0b000000-0000-4000-8000-00000000000b/c2000000-0000-4000-8000-000000000002/private.jpg'
 where id='c4000000-0000-4000-8000-000000000001'
$cmd$, 'UPDATE não publica mídia alheia');
select pg_temp.deny($cmd$
 update public.journal_media set file_path='0a000000-0000-4000-8000-00000000000a/c2000000-0000-4000-8000-000000000002/own.jpg'
 where id='c4000000-0000-4000-8000-000000000001'
$cmd$, 'mídia não atravessa entradas');

set local request.jwt.claims = '{"sub":"0b000000-0000-4000-8000-00000000000b"}';
update public.tickets set title='Editor alterou o título' where id='c3000000-0000-4000-8000-000000000001';
select pg_temp.check(exists(select 1 from public.tickets where title='Editor alterou o título'), 'editor preserva referência existente ao editar título');
insert into public.journal_media(journal_entry_id,file_path,mime_type) values
 ('c2000000-0000-4000-8000-000000000001','0b000000-0000-4000-8000-00000000000b/c2000000-0000-4000-8000-000000000001/editor.jpg','image/jpeg');
select pg_temp.check(exists(select 1 from public.journal_media where file_path like '%/editor.jpg'), 'editor pode anexar upload próprio a entrada compartilhada');
set local request.jwt.claims = '{"sub":"0a000000-0000-4000-8000-00000000000a"}';
select pg_temp.check((select count(*) from storage.objects)=0, 'arquivos privados continuam invisíveis após tentativas');
rollback;
