-- Esquema do derecord.
--
-- Cole isto inteiro no SQL Editor do painel do Supabase e rode uma vez.
-- Pode rodar de novo sem medo: tudo é idempotente.
--
-- Não há contas de usuário: quem tem o endereço entra. As regras abaixo
-- deixam qualquer um ler e escrever, mas limitam tamanho para que um erro
-- (ou uma brincadeira) não encha o banco.

-- ---------- mensagens -------------------------------------------------------

create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  room        text not null,
  author_id   text not null,
  name        text not null,
  text        text not null default '',
  image       jsonb,
  reply_to    jsonb,
  mentions    text[] not null default '{}',
  created_at  timestamptz not null default now()
);

-- O chat sempre busca as últimas N de uma sala; é este índice que sustenta isso.
create index if not exists messages_room_created_idx
  on public.messages (room, created_at desc);

alter table public.messages enable row level security;

drop policy if exists "leitura livre" on public.messages;
create policy "leitura livre"
  on public.messages for select
  using (true);

drop policy if exists "escrita com limite" on public.messages;
create policy "escrita com limite"
  on public.messages for insert
  with check (
    length(text) <= 2000
    and length(name) <= 32
    and length(room) <= 60
    and coalesce(array_length(mentions, 1), 0) <= 30
    -- mensagem vazia só passa se trouxer imagem
    and (length(btrim(text)) > 0 or image is not null)
  );

-- Permissão explícita para o papel anônimo (é com ele que o navegador fala).
-- Sem isto o app depende da opção "Automatically expose new tables" estar
-- ligada no projeto; com isto, funciona de qualquer jeito. Quem de fato
-- controla o acesso são as policies acima, não estes grants.
grant usage on schema public to anon, authenticated;
grant select, insert on public.messages to anon, authenticated;

-- Sem isto o cliente não recebe as mensagens novas em tempo real.
do $$
begin
  alter publication supabase_realtime add table public.messages;
exception
  when duplicate_object then null;
end $$;

-- ---------- imagens ---------------------------------------------------------

-- O limite de 8 MB e os tipos aceitos valem no servidor: mesmo que alguém
-- burle o cliente, o Supabase recusa.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'images',
  'images',
  true,
  8388608,
  array['image/png', 'image/jpeg', 'image/gif', 'image/webp']
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "imagens leitura" on storage.objects;
create policy "imagens leitura"
  on storage.objects for select
  using (bucket_id = 'images');

drop policy if exists "imagens envio" on storage.objects;
create policy "imagens envio"
  on storage.objects for insert
  with check (bucket_id = 'images');

-- ---------- limpeza opcional ------------------------------------------------

-- O plano grátis dá 500 MB de banco e 1 GB de storage. Para 6 pessoas isso
-- leva anos, mas se um dia quiser podar o histórico:
--
--   delete from public.messages where created_at < now() - interval '1 year';

-- ---------- membros ---------------------------------------------------------

-- Sem isto não existe "offline": a lista de quem está fora só pode sair de um
-- registro de quem já entrou alguma vez. O id vem do navegador e é guardado
-- lá, então a mesma pessoa continua a mesma entre sessões.
create table if not exists public.members (
  id         text primary key,
  room       text not null,
  name       text not null,
  last_seen  timestamptz not null default now()
);

create index if not exists members_room_idx on public.members (room, last_seen desc);

alter table public.members enable row level security;

drop policy if exists "membros leitura" on public.members;
create policy "membros leitura"
  on public.members for select
  using (true);

drop policy if exists "membros entrada" on public.members;
create policy "membros entrada"
  on public.members for insert
  with check (length(name) <= 32 and length(room) <= 60 and length(id) <= 64);

-- Entrar de novo atualiza nome e horário da mesma linha.
drop policy if exists "membros atualizacao" on public.members;
create policy "membros atualizacao"
  on public.members for update
  using (true)
  with check (length(name) <= 32 and length(room) <= 60);

grant select, insert, update on public.members to anon, authenticated;
