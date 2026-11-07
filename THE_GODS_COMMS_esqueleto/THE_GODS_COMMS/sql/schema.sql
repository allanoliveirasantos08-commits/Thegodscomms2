-- THE GODS COMMS: esquema inicial para Supabase
-- Execute no SQL Editor de um projeto novo.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Membro',
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

alter table public.profiles enable row level security;
alter table public.channels enable row level security;
alter table public.messages enable row level security;

-- Protótipo inicial: usuários autenticados podem ver perfis/canais/mensagens.
-- A criação de canais e envio de mensagens exige autenticação.
create policy "profiles readable by authenticated" on public.profiles
for select to authenticated using (true);
create policy "users can create own profile" on public.profiles
for insert to authenticated with check (auth.uid() = id);
create policy "users can update own profile" on public.profiles
for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

create policy "channels readable by authenticated" on public.channels
for select to authenticated using (true);
create policy "authenticated users create channels" on public.channels
for insert to authenticated with check (auth.uid() = created_by);

create policy "messages readable by authenticated" on public.messages
for select to authenticated using (true);
create policy "users send own messages" on public.messages
for insert to authenticated with check (auth.uid() = user_id);

-- Adiciona a tabela messages à publicação Realtime (se ainda não estiver nela).
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null;
when undefined_object then raise notice 'Publication supabase_realtime não encontrada; habilite Realtime pelo painel.';
end $$;

-- Canal inicial de texto e call (a call ainda não usa WebRTC).
insert into public.channels (name,type)
select 'avisos','text' where not exists (select 1 from public.channels where name='avisos');
insert into public.channels (name,type)
select 'geral','text' where not exists (select 1 from public.channels where name='geral');
insert into public.channels (name,type)
select 'call-principal','voice' where not exists (select 1 from public.channels where name='call-principal');
