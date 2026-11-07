-- THE GODS COMMS V2 | Execute no SQL Editor do Supabase.
-- Script de atualização idempotente: preserva canais, mensagens e perfis existentes.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Guerreiro',
  created_at timestamptz not null default now()
);

create table if not exists public.channels (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null check (type in ('text','voice')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 2000),
  created_at timestamptz not null default now()
);

-- Garante que o nome de exibição exista para todos os usuários já cadastrados.
insert into public.profiles (id, display_name)
select u.id, coalesce(nullif(u.raw_user_meta_data->>'display_name',''), split_part(u.email,'@',1), 'Guerreiro')
from auth.users u
on conflict (id) do nothing;

-- Cria automaticamente o perfil no cadastro de novas contas.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'display_name',''), nullif(split_part(new.email,'@',1),''), 'Guerreiro')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.channels enable row level security;
alter table public.messages enable row level security;

drop policy if exists "profiles readable by authenticated" on public.profiles;
create policy "profiles readable by authenticated" on public.profiles
for select to authenticated using (true);
drop policy if exists "users can create own profile" on public.profiles;
create policy "users can create own profile" on public.profiles
for insert to authenticated with check (auth.uid() = id);
drop policy if exists "users can update own profile" on public.profiles;
create policy "users can update own profile" on public.profiles
for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "channels readable by authenticated" on public.channels;
create policy "channels readable by authenticated" on public.channels
for select to authenticated using (true);
drop policy if exists "authenticated users create channels" on public.channels;
create policy "authenticated users create channels" on public.channels
for insert to authenticated with check (auth.uid() = created_by);

drop policy if exists "messages readable by authenticated" on public.messages;
create policy "messages readable by authenticated" on public.messages
for select to authenticated using (true);
drop policy if exists "users send own messages" on public.messages;
create policy "users send own messages" on public.messages
for insert to authenticated with check (auth.uid() = user_id);

-- Realtime: habilita eventos INSERT da tabela de mensagens.
do $$
begin
  alter publication supabase_realtime add table public.messages;
exception
  when duplicate_object then null;
  when undefined_object then raise notice 'Publication supabase_realtime não encontrada. Habilite Realtime manualmente.';
end $$;

-- Canais padrão são inseridos apenas se ainda não existirem.
insert into public.channels (name,type) select 'avisos','text'
where not exists (select 1 from public.channels where name='avisos');
insert into public.channels (name,type) select 'geral','text'
where not exists (select 1 from public.channels where name='geral');
insert into public.channels (name,type) select 'call-principal','voice'
where not exists (select 1 from public.channels where name='call-principal');
