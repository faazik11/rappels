-- Appli « Rappels » (faazik11/rappels) : tables à part, préfixées rappels_, sans lien avec le GDC.
-- Chaque téléphone a une clé secrète (uuid) ; tout passe par des fonctions qui vérifient cette clé.
-- Appliquée sur le projet Supabase « Appli GDC ». Les valeurs de rappels_secrets sont saisies dans la base, jamais ici.

create table public.rappels_devices (
  key uuid primary key,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

create table public.rappels_tasks (
  device uuid not null references public.rappels_devices(key) on delete cascade,
  id text not null,
  name text not null,
  emoji text not null default '⭐',
  color text not null default '#ffc93c',
  goal int not null default 5 check (goal between 1 and 50),
  ord int not null default 0,
  primary key (device, id)
);

create table public.rappels_reminders (
  device uuid not null references public.rappels_devices(key) on delete cascade,
  id text not null,
  time text not null check (time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  days int[] not null default '{1,2,3,4,5}',
  text text not null default '',
  task_id text,
  skip_if_done boolean not null default false,
  enabled boolean not null default true,
  primary key (device, id)
);
create index rappels_reminders_time_idx on public.rappels_reminders(time) where enabled;

create table public.rappels_progress (
  device uuid not null references public.rappels_devices(key) on delete cascade,
  day date not null,
  task_id text not null,
  n int not null default 0 check (n >= 0),
  primary key (device, day, task_id)
);

create table public.rappels_push (
  endpoint text primary key,
  device uuid not null references public.rappels_devices(key) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index rappels_push_device_idx on public.rappels_push(device);

create table public.rappels_secrets (name text primary key, value text not null);

alter table public.rappels_devices enable row level security;
alter table public.rappels_tasks enable row level security;
alter table public.rappels_reminders enable row level security;
alter table public.rappels_progress enable row level security;
alter table public.rappels_push enable row level security;
alter table public.rappels_secrets enable row level security;
revoke all on public.rappels_devices, public.rappels_tasks, public.rappels_reminders,
  public.rappels_progress, public.rappels_push, public.rappels_secrets from anon, authenticated;

-- Charge tout pour un téléphone (et l'enregistre au premier passage)
create function public.rappels_load(p_key uuid, p_day date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_new boolean := false;
begin
  insert into public.rappels_devices(key) values (p_key)
  on conflict (key) do update set last_seen = now()
  returning (xmax = 0) into v_new;
  return jsonb_build_object(
    'isNew', v_new,
    'vapidPublic', (select value from public.rappels_secrets where name = 'vapid_public'),
    'tasks', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'emoji', emoji, 'color', color, 'goal', goal, 'order', ord) order by ord)
                        from public.rappels_tasks where device = p_key), '[]'::jsonb),
    'reminders', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'time', time, 'days', to_jsonb(days), 'text', text, 'taskId', task_id,
                                                               'skipIfDone', skip_if_done, 'enabled', enabled) order by time)
                            from public.rappels_reminders where device = p_key), '[]'::jsonb),
    'counts', coalesce((select jsonb_object_agg(task_id, n) from public.rappels_progress where device = p_key and day = p_day), '{}'::jsonb)
  );
end;
$$;

create function public.rappels_save_task(p_key uuid, p jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.rappels_tasks(device, id, name, emoji, color, goal, ord)
  select p_key, p->>'id', left(p->>'name', 40), left(p->>'emoji', 8), left(p->>'color', 16), (p->>'goal')::int, coalesce((p->>'order')::int, 0)
  where exists (select 1 from public.rappels_devices where key = p_key)
  on conflict (device, id) do update set name = excluded.name, emoji = excluded.emoji, color = excluded.color, goal = excluded.goal, ord = excluded.ord;
$$;

create function public.rappels_delete_task(p_key uuid, p_id text)
returns void language sql security definer set search_path = '' as $$
  update public.rappels_reminders set task_id = null, skip_if_done = false where device = p_key and task_id = p_id;
  delete from public.rappels_tasks where device = p_key and id = p_id;
$$;

create function public.rappels_save_reminder(p_key uuid, p jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.rappels_reminders(device, id, time, days, text, task_id, skip_if_done, enabled)
  select p_key, p->>'id', p->>'time',
         array(select jsonb_array_elements_text(p->'days')::int),
         left(coalesce(p->>'text', ''), 120), nullif(p->>'taskId', ''),
         coalesce((p->>'skipIfDone')::boolean, false), coalesce((p->>'enabled')::boolean, true)
  where exists (select 1 from public.rappels_devices where key = p_key)
  on conflict (device, id) do update set time = excluded.time, days = excluded.days, text = excluded.text,
    task_id = excluded.task_id, skip_if_done = excluded.skip_if_done, enabled = excluded.enabled;
$$;

create function public.rappels_delete_reminder(p_key uuid, p_id text)
returns void language sql security definer set search_path = '' as $$
  delete from public.rappels_reminders where device = p_key and id = p_id;
$$;

create function public.rappels_bump(p_key uuid, p_day date, p_task text, p_delta int)
returns int language sql security definer set search_path = '' as $$
  insert into public.rappels_progress(device, day, task_id, n)
  select p_key, p_day, p_task, greatest(0, p_delta)
  where exists (select 1 from public.rappels_tasks where device = p_key and id = p_task)
  on conflict (device, day, task_id) do update set n = greatest(0, public.rappels_progress.n + p_delta)
  returning n;
$$;

create function public.rappels_save_push(p_key uuid, p_endpoint text, p_p256dh text, p_auth text)
returns void language sql security definer set search_path = '' as $$
  insert into public.rappels_push(endpoint, device, p256dh, auth)
  select p_endpoint, p_key, p_p256dh, p_auth
  where exists (select 1 from public.rappels_devices where key = p_key)
  on conflict (endpoint) do update set device = excluded.device, p256dh = excluded.p256dh, auth = excluded.auth;
$$;

-- Appelle le service d'envoi (Edge Function rappels-notify)
create function public.rappels_call(payload jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_url text := (select value from public.rappels_secrets where name = 'functions_url');
  v_token text := (select value from public.rappels_secrets where name = 'notify_token');
begin
  if v_url is null or v_token is null then return; end if;
  perform net.http_post(
    url := v_url || '/rappels-notify',
    body := payload,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-rappels-token', v_token)
  );
end;
$$;
revoke execute on function public.rappels_call(jsonb) from public, anon, authenticated;

-- Notification de test, envoyée juste après l'activation
create function public.rappels_test_push(p_key uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.rappels_devices where key = p_key) then
    perform public.rappels_call(jsonb_build_object('type', 'test', 'device', p_key));
  end if;
end;
$$;

grant execute on function public.rappels_load(uuid, date), public.rappels_save_task(uuid, jsonb), public.rappels_delete_task(uuid, text),
  public.rappels_save_reminder(uuid, jsonb), public.rappels_delete_reminder(uuid, text), public.rappels_bump(uuid, date, text, int),
  public.rappels_save_push(uuid, text, text, text), public.rappels_test_push(uuid) to anon, authenticated;

-- Toutes les minutes : envoie les rappels prévus à cette minute (heure de Paris)
select cron.schedule('rappels-minute', '* * * * *', $$select public.rappels_call('{"type":"tick"}'::jsonb)$$);
