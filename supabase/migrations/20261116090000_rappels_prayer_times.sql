-- Horaires des prières (source : calendriers APBIF, apbif.fr/horaires-des-prieres)
-- Données importées le 15/11/2026 pour les 79 villes du site (année 2026).
create table public.rappels_cities (
  id int primary key,          -- identifiant de la ville chez l'APBIF (cityId)
  name text not null
);
create table public.rappels_prayer_times (
  city_id int not null references public.rappels_cities(id) on delete cascade,
  day date not null,
  fajr text not null, shuruq text not null, dhuhr text not null,
  asr text not null, maghrib text not null, isha text not null,
  primary key (city_id, day)
);
alter table public.rappels_cities enable row level security;
alter table public.rappels_prayer_times enable row level security;
create policy "lecture libre" on public.rappels_cities for select to anon, authenticated using (true);
create policy "lecture libre" on public.rappels_prayer_times for select to anon, authenticated using (true);
grant select on public.rappels_cities, public.rappels_prayer_times to anon, authenticated;
revoke insert, update, delete on public.rappels_cities, public.rappels_prayer_times from anon, authenticated;
