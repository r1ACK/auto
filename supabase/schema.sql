-- =====================================================================
-- Auto Timetable - Supabase schema
-- Run this whole file once in Supabase Dashboard > SQL Editor, then run seed.sql
-- =====================================================================

-- ---------- Core data ----------
create table if not exists public.teachers (
  id               text primary key,
  name             text not null,
  position         text not null check (position in ('head', 'regular', 'general')),
  department       text not null check (department in ('computer', 'general')),
  min_hours        int check (min_hours is null or min_hours >= 0),
  max_hours        int check (max_hours is null or max_hours >= 0),
  unavailable      jsonb not null default '[]'::jsonb,   -- [{day:0,start:'08:00',end:'12:00'}]
  soft_unavailable jsonb not null default '[]'::jsonb,
  subject_ids      text[] not null default '{}',        -- general teachers: subjects they teach
  updated_at       timestamptz not null default now()
);
create index if not exists teachers_department_idx on public.teachers (department);

create table if not exists public.groups (
  id          text primary key,
  name        text not null,
  students    int not null default 0 check (students >= 0),
  advisor_id  text references public.teachers (id) on delete set null,
  updated_at  timestamptz not null default now()
);
create index if not exists groups_advisor_idx on public.groups (advisor_id);

create table if not exists public.rooms (
  id          text primary key,
  name        text not null,
  type        text not null check (type in ('computer', 'theory')),
  updated_at  timestamptz not null default now()
);
create index if not exists rooms_type_idx on public.rooms (type);

create table if not exists public.subjects (
  id            text primary key,
  name          text not null,
  periods       int not null check (periods between 1 and 40),
  room_type     text not null check (room_type in ('computer', 'theory', 'any', 'field')),
  category      text not null check (category in ('dept', 'general', 'activity')),
  fixed_day     int check (fixed_day is null or fixed_day between 0 and 4),
  fixed_start   text check (fixed_start is null or fixed_start ~ '^[0-2][0-9]:[0-5][0-9]$'),
  combined      boolean not null default false,
  location_text text,
  updated_at    timestamptz not null default now()
);
create index if not exists subjects_category_idx on public.subjects (category);

-- ---------- Users ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    text not null unique check (username ~ '^[a-z0-9._-]{3,30}$'),
  full_name   text,
  role        text not null default 'student' check (role in ('teacher', 'student')),
  group_id    text references public.groups (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists profiles_role_idx on public.profiles (role);
create index if not exists profiles_group_idx on public.profiles (group_id);

-- ---------- Generated timetables ----------
create table if not exists public.schedules (
  id             bigint generated always as identity primary key,
  created_at     timestamptz not null default now(),
  created_by     uuid references auth.users (id) on delete set null default auth.uid(),
  duration_ms    int not null,
  attempts       int,
  score          numeric,
  algorithm      text,
  assignments    jsonb not null,
  report         jsonb,
  data_snapshot  jsonb not null
);
create index if not exists schedules_created_at_idx on public.schedules (created_at desc);

-- ---------- Private secrets (NOT exposed by the API) ----------
create schema if not exists private;
create table if not exists private.app_secrets (
  key   text primary key,
  value text not null
);
-- Change this code! Teachers enter it when registering.
insert into private.app_secrets (key, value) values ('teacher_invite_code', 'TEACHER-2569')
on conflict (key) do nothing;

-- ---------- Helper: is current user a teacher? ----------
create or replace function public.is_teacher()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'teacher');
$$;

-- ---------- Signup triggers ----------
-- BEFORE: decide role server-side from the secret invite code, store in app_metadata
-- (users cannot edit app_metadata), and remove the code from user_metadata.
create or replace function private.before_user_created()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_code text := coalesce(new.raw_user_meta_data ->> 'invite_code', '');
  v_role text := 'student';
begin
  if v_code <> '' and v_code = (select value from private.app_secrets where key = 'teacher_invite_code') then
    v_role := 'teacher';
  end if;
  new.raw_app_meta_data := coalesce(new.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', v_role);
  new.raw_user_meta_data := coalesce(new.raw_user_meta_data, '{}'::jsonb) - 'invite_code';
  return new;
end;
$$;

-- AFTER: create the profile row
create or replace function private.after_user_created()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_role text := coalesce(new.raw_app_meta_data ->> 'role', 'student');
begin
  insert into public.profiles (id, username, full_name, role, group_id)
  values (
    new.id,
    lower(new.raw_user_meta_data ->> 'username'),
    new.raw_user_meta_data ->> 'full_name',
    v_role,
    case when v_role = 'student'
      then (select g.id from public.groups g where g.id = new.raw_user_meta_data ->> 'group_id')
      else null end
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_before_insert on auth.users;
create trigger on_auth_user_before_insert
  before insert on auth.users
  for each row execute function private.before_user_created();

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.after_user_created();

-- ---------- Atomic import (teachers only) ----------
-- Upsert everything in the payload, then delete rows that are not in it.
create or replace function public.replace_dataset(payload jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.is_teacher() then
    raise exception 'forbidden: teacher role required';
  end if;

  insert into public.teachers (id, name, position, department, min_hours, max_hours, unavailable, soft_unavailable, subject_ids, updated_at)
  select x.id, x.name, x.position, x.department, x.min_hours, x.max_hours,
         coalesce(x.unavailable, '[]'::jsonb), coalesce(x.soft_unavailable, '[]'::jsonb), coalesce(x.subject_ids, '{}'), now()
  from jsonb_to_recordset(coalesce(payload -> 'teachers', '[]'::jsonb))
       as x(id text, name text, position text, department text, min_hours int, max_hours int,
            unavailable jsonb, soft_unavailable jsonb, subject_ids text[])
  on conflict (id) do update set
    name = excluded.name, position = excluded.position, department = excluded.department,
    min_hours = excluded.min_hours, max_hours = excluded.max_hours, unavailable = excluded.unavailable,
    soft_unavailable = excluded.soft_unavailable, subject_ids = excluded.subject_ids, updated_at = now();

  insert into public.rooms (id, name, type, updated_at)
  select x.id, x.name, x.type, now()
  from jsonb_to_recordset(coalesce(payload -> 'rooms', '[]'::jsonb)) as x(id text, name text, type text)
  on conflict (id) do update set name = excluded.name, type = excluded.type, updated_at = now();

  insert into public.subjects (id, name, periods, room_type, category, fixed_day, fixed_start, combined, location_text, updated_at)
  select x.id, x.name, x.periods, x.room_type, x.category, x.fixed_day, nullif(x.fixed_start, ''),
         coalesce(x.combined, false), x.location_text, now()
  from jsonb_to_recordset(coalesce(payload -> 'subjects', '[]'::jsonb))
       as x(id text, name text, periods int, room_type text, category text, fixed_day int,
            fixed_start text, combined boolean, location_text text)
  on conflict (id) do update set
    name = excluded.name, periods = excluded.periods, room_type = excluded.room_type, category = excluded.category,
    fixed_day = excluded.fixed_day, fixed_start = excluded.fixed_start, combined = excluded.combined,
    location_text = excluded.location_text, updated_at = now();

  insert into public.groups (id, name, students, advisor_id, updated_at)
  select x.id, x.name, coalesce(x.students, 0), nullif(x.advisor_id, ''), now()
  from jsonb_to_recordset(coalesce(payload -> 'groups', '[]'::jsonb))
       as x(id text, name text, students int, advisor_id text)
  on conflict (id) do update set
    name = excluded.name, students = excluded.students, advisor_id = excluded.advisor_id, updated_at = now();

  delete from public.groups where id not in (select e ->> 'id' from jsonb_array_elements(coalesce(payload -> 'groups', '[]'::jsonb)) e);
  delete from public.subjects where id not in (select e ->> 'id' from jsonb_array_elements(coalesce(payload -> 'subjects', '[]'::jsonb)) e);
  delete from public.rooms where id not in (select e ->> 'id' from jsonb_array_elements(coalesce(payload -> 'rooms', '[]'::jsonb)) e);
  delete from public.teachers where id not in (select e ->> 'id' from jsonb_array_elements(coalesce(payload -> 'teachers', '[]'::jsonb)) e);
end;
$$;

-- ---------- Row Level Security ----------
alter table public.teachers  enable row level security;
alter table public.groups    enable row level security;
alter table public.rooms     enable row level security;
alter table public.subjects  enable row level security;
alter table public.profiles  enable row level security;
alter table public.schedules enable row level security;
alter table private.app_secrets enable row level security; -- no policies = no access

-- Read
drop policy if exists "read teachers" on public.teachers;
create policy "read teachers" on public.teachers for select to authenticated using (true);
drop policy if exists "read groups" on public.groups;
create policy "read groups" on public.groups for select to anon, authenticated using (true); -- needed on register page
drop policy if exists "read rooms" on public.rooms;
create policy "read rooms" on public.rooms for select to authenticated using (true);
drop policy if exists "read subjects" on public.subjects;
create policy "read subjects" on public.subjects for select to authenticated using (true);
drop policy if exists "read schedules" on public.schedules;
create policy "read schedules" on public.schedules for select to authenticated using (true);

-- Write: teachers only
drop policy if exists "teacher write teachers" on public.teachers;
create policy "teacher write teachers" on public.teachers for all to authenticated using (public.is_teacher()) with check (public.is_teacher());
drop policy if exists "teacher write groups" on public.groups;
create policy "teacher write groups" on public.groups for all to authenticated using (public.is_teacher()) with check (public.is_teacher());
drop policy if exists "teacher write rooms" on public.rooms;
create policy "teacher write rooms" on public.rooms for all to authenticated using (public.is_teacher()) with check (public.is_teacher());
drop policy if exists "teacher write subjects" on public.subjects;
create policy "teacher write subjects" on public.subjects for all to authenticated using (public.is_teacher()) with check (public.is_teacher());
drop policy if exists "teacher insert schedules" on public.schedules;
create policy "teacher insert schedules" on public.schedules for insert to authenticated with check (public.is_teacher());
drop policy if exists "teacher delete schedules" on public.schedules;
create policy "teacher delete schedules" on public.schedules for delete to authenticated using (public.is_teacher());

-- Profiles: own row, teachers see/update all (change role / group)
drop policy if exists "read own or teacher" on public.profiles;
create policy "read own or teacher" on public.profiles for select to authenticated using (id = auth.uid() or public.is_teacher());
drop policy if exists "teacher update profiles" on public.profiles;
create policy "teacher update profiles" on public.profiles for update to authenticated using (public.is_teacher()) with check (public.is_teacher());

-- ---------- Grants (RLS still applies) ----------
grant usage on schema public to anon, authenticated;
grant select on public.groups to anon;
grant select, insert, update, delete on public.teachers, public.groups, public.rooms, public.subjects, public.schedules to authenticated;
grant select, update on public.profiles to authenticated;
grant execute on function public.is_teacher() to authenticated;
grant execute on function public.replace_dataset(jsonb) to authenticated;
revoke all on schema private from anon, authenticated;
