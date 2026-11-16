-- Prières + Tahsin : ville et réglages par téléphone, horaires du jour avec repli sur l'année précédente
alter table public.rappels_devices
  add column city_id int not null default 54 references public.rappels_cities(id),
  add column settings jsonb not null default '{}'::jsonb;

create function public.rappels_day_times(p_city int, p_day date)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('day', p_day, 'fajr', fajr, 'shuruq', shuruq, 'dhuhr', dhuhr, 'asr', asr, 'maghrib', maghrib, 'isha', isha,
                            'exact', t.day = p_day)
  from public.rappels_prayer_times t
  where t.city_id = p_city
    and (t.day = p_day or (extract(month from t.day) = extract(month from p_day)
                           and extract(day from t.day) = least(extract(day from p_day), case when extract(month from p_day) = 2 then 28 else 31 end)))
  order by (t.day = p_day) desc, t.day desc
  limit 1;
$$;

create or replace function public.rappels_load(p_key uuid, p_day date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_new boolean := false;
  v_dev public.rappels_devices;
begin
  insert into public.rappels_devices(key) values (p_key)
  on conflict (key) do update set last_seen = now()
  returning (xmax = 0) into v_new;
  select * into v_dev from public.rappels_devices where key = p_key;
  return jsonb_build_object(
    'isNew', v_new,
    'vapidPublic', (select value from public.rappels_secrets where name = 'vapid_public'),
    'cityId', v_dev.city_id,
    'settings', v_dev.settings,
    'times', jsonb_build_array(public.rappels_day_times(v_dev.city_id, p_day - 1), public.rappels_day_times(v_dev.city_id, p_day),
                               public.rappels_day_times(v_dev.city_id, p_day + 1)),
    'reminders', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'time', time, 'days', to_jsonb(days), 'text', text, 'taskId', task_id,
                                                               'skipIfDone', skip_if_done, 'enabled', enabled) order by time)
                            from public.rappels_reminders where device = p_key), '[]'::jsonb),
    'progress', coalesce((select jsonb_object_agg(day::text, c) from (
                  select day, jsonb_object_agg(task_id, n) c from public.rappels_progress
                  where device = p_key and day between p_day - 1 and p_day group by day) s), '{}'::jsonb)
  );
end;
$$;

create function public.rappels_set_city(p_key uuid, p_city int)
returns void language sql security definer set search_path = '' as $$
  update public.rappels_devices set city_id = p_city where key = p_key and exists (select 1 from public.rappels_cities where id = p_city);
$$;

create function public.rappels_set_settings(p_key uuid, p_settings jsonb)
returns void language sql security definer set search_path = '' as $$
  update public.rappels_devices set settings = p_settings where key = p_key and pg_column_size(p_settings) < 4000;
$$;

create or replace function public.rappels_bump(p_key uuid, p_day date, p_task text, p_delta int)
returns int language sql security definer set search_path = '' as $$
  insert into public.rappels_progress(device, day, task_id, n)
  select p_key, p_day, left(p_task, 60), least(100, greatest(0, p_delta))
  where exists (select 1 from public.rappels_devices where key = p_key)
  on conflict (device, day, task_id) do update set n = least(100, greatest(0, public.rappels_progress.n + p_delta))
  returning n;
$$;

create function public.rappels_set_progress(p_key uuid, p_day date, p_values jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.rappels_progress(device, day, task_id, n)
  select p_key, p_day, left(k, 60), least(100, greatest(0, v::int))
  from jsonb_each_text(p_values) as e(k, v)
  where exists (select 1 from public.rappels_devices where key = p_key)
  on conflict (device, day, task_id) do update set n = excluded.n;
$$;

grant execute on function public.rappels_set_city(uuid, int), public.rappels_set_settings(uuid, jsonb),
  public.rappels_set_progress(uuid, date, jsonb) to anon, authenticated;
revoke execute on function public.rappels_day_times(int, date) from public, anon, authenticated;
