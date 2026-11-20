-- =====================================================================
-- Wish – Datenbank-Schema, Sicherheitsregeln (RLS) und Schutz-Trigger
-- Datei: supabase/01_schema.sql
-- Wird als eine Migration eingespielt: bei einem Fehler wird nichts gespeichert.
-- Anmeldung ohne E-Mail: anonyme Supabase-Sitzung + 12-stelliger Hex-Code.
-- =====================================================================

begin;

-- In Supabase bereits vorhanden; für Hash und Zufallswerte der Einladungscodes
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- 0. Privates Schema für Hilfsfunktionen
--    "private" wird NICHT über die API veröffentlicht. Die Funktionen
--    darin sind von außen nicht aufrufbar, nur innerhalb der Regeln.
-- ---------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- Neue Funktionen sind standardmäßig für alle ausführbar. Das schalten
-- wir für alles ab, was ab jetzt angelegt wird.
alter default privileges in schema private revoke execute on functions from public;
alter default privileges in schema public  revoke execute on functions from public;
alter default privileges in schema public  revoke all on tables    from anon;
alter default privileges in schema public  revoke all on functions from anon;
alter default privileges in schema public  revoke all on sequences from anon;

-- ---------------------------------------------------------------------
-- 1. Tabellen
-- ---------------------------------------------------------------------

-- Mitglieder = die beiden Eltern. Anmeldung ohne E-Mail (anonyme Sitzung
-- auf dem iPhone); Mitglied wird man nur über den Haushaltscode.
create table public.members (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  -- Für die Verschlüsselung auf dem iPhone (Phase 3):
  -- key_salt  = Zufallswert zur Ableitung des Schlüssels aus dem Geheimwort
  -- key_check = verschlüsselter Prüfwert, um ein falsches Geheimwort zu erkennen
  key_salt     text check (char_length(key_salt)  <= 200),
  key_check    text check (char_length(key_check) <= 1000),
  created_at   timestamptz not null default now()
);

-- Personen = alle Beschenkten (Kinder, Freunde, Familie, die Eltern selbst).
-- member_id verknüpft die Person mit einem Elternteil. Daran hängt der Spoilerschutz.
create table public.persons (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 60),
  emoji       text check (char_length(emoji) <= 16),
  color       text check (color ~ '^#[0-9a-fA-F]{6}$'),
  birth_month smallint check (birth_month between 1 and 12),
  birth_day   smallint check (birth_day between 1 and 31),
  birth_year  smallint check (birth_year between 1900 and 2100),
  note        text check (char_length(note) <= 2000),
  member_id   uuid unique references public.members(user_id) on update cascade on delete restrict,
  archived    boolean not null default false,
  created_by  uuid not null default auth.uid() references public.members(user_id) on update cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check ((birth_month is null) = (birth_day is null))
);

-- Anlässe. person_id leer = gilt für alle (z. B. Weihnachten).
-- kind 'fixed'  = fester Tag (month/day)
-- kind 'easter' = Ostersonntag, wird in der App je Jahr berechnet
-- Geburtstage stehen direkt bei der Person und brauchen keinen Eintrag hier.
create table public.occasions (
  id         uuid primary key default gen_random_uuid(),
  person_id  uuid references public.persons(id) on delete cascade,
  title      text not null check (char_length(title) between 1 and 60),
  kind       text not null default 'fixed' check (kind in ('fixed', 'easter')),
  month      smallint check (month between 1 and 12),
  day        smallint check (day between 1 and 31),
  year       smallint check (year between 2000 and 2100),
  recurring  boolean not null default true,
  created_by uuid default auth.uid() references public.members(user_id) on update cascade on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind = 'easter' or (month is not null and day is not null)),
  check (recurring or year is not null)
);

-- Ideen und Wünsche. Es gibt drei Arten, die sich aus Empfänger und
-- Ersteller ergeben:
--   gemeinsam : Empfänger ist kein Elternteil       -> Klartext, beide sehen sie
--   Wunsch    : Elternteil wünscht sich selbst etwas -> Klartext, beide sehen ihn
--   geheim    : Elternteil plant für den Partner     -> NUR verschlüsselt (enc),
--               sichtbar nur für den Ersteller
create table public.ideas (
  id           uuid primary key default gen_random_uuid(),
  person_id    uuid not null references public.persons(id) on delete cascade,
  created_by   uuid not null default auth.uid() references public.members(user_id) on update cascade on delete cascade,
  enc          text check (char_length(enc) <= 200000),
  title        text check (char_length(title) between 1 and 200),
  note         text check (char_length(note) <= 4000),
  url          text check (char_length(url) <= 2000 and url ~* '^https?://'),
  shop         text check (char_length(shop) <= 100),
  price_cents  integer check (price_cents between 0 and 100000000),
  details      text check (char_length(details) <= 500),
  priority     smallint check (priority between 0 and 2),
  occasion_id  uuid references public.occasions(id) on delete set null,
  for_birthday boolean not null default false,
  retracted_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (not (for_birthday and occasion_id is not null))
);

-- Weitere Empfänger einer gemeinsamen Idee (z. B. ein Spiel für beide Kinder).
-- Nur für Nicht-Eltern erlaubt.
create table public.idea_co_recipients (
  idea_id   uuid not null references public.ideas(id) on delete cascade,
  person_id uuid not null references public.persons(id) on delete cascade,
  primary key (idea_id, person_id)
);

-- Status gemeinsamer Ideen: reserviert, gekauft, verschenkt.
-- Für Geschenke an einen Elternteil gibt es hier NIE einen Eintrag.
-- Deren Status steht verschlüsselt in der geheimen Idee selbst.
create table public.gift_status (
  idea_id       uuid primary key references public.ideas(id) on delete cascade,
  status        text not null check (status in ('reserved', 'bought', 'given')),
  buyer         uuid not null default auth.uid() references public.members(user_id) on update cascade,
  paid_cents    integer check (paid_cents between 0 and 100000000),
  bought_on     date,
  given_on      date,
  occasion_id   uuid references public.occasions(id) on delete set null,
  for_birthday  boolean not null default false,
  occasion_year smallint not null default extract(year from now())::smallint
                check (occasion_year between 2000 and 2100),
  updated_at    timestamptz not null default now(),
  check (not (for_birthday and occasion_id is not null))
);

create index ideas_person_idx       on public.ideas (person_id);
create index ideas_created_by_idx   on public.ideas (created_by);
create index ideas_occasion_idx     on public.ideas (occasion_id);
create index occasions_person_idx   on public.occasions (person_id);
create index co_recipients_person   on public.idea_co_recipients (person_id);
create index gift_status_occ_idx    on public.gift_status (occasion_id);
create index gift_status_buyer_idx  on public.gift_status (buyer);

-- ---------------------------------------------------------------------
-- 2. Hilfsfunktionen (privat, nur für Regeln und Trigger)
-- ---------------------------------------------------------------------

-- Ist der angemeldete Nutzer ein Mitglied des Haushalts?
create function private.is_member()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.members m where m.user_id = auth.uid());
$$;

-- Mit welchem Elternteil ist eine Person verknüpft? (null = mit keinem)
create function private.person_member(p_person uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select p.member_id from public.persons p where p.id = p_person;
$$;

-- Existiert dieses Mitglied (noch)? Unterscheidet die Übertragung auf ein
-- neues Gerät (user_id ändert sich per Kaskade) von einer unerlaubten Änderung.
create function private.member_exists(p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.members m where m.user_id = p_user);
$$;

-- Darf der angemeldete Nutzer diese Idee sehen?
create function private.idea_visible(p_person uuid, p_created_by uuid, p_retracted timestamptz)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_rm  uuid;
begin
  if v_uid is null or not private.is_member() then
    return false;
  end if;
  v_rm := private.person_member(p_person);
  -- gemeinsame Idee
  if v_rm is null then
    return true;
  end if;
  -- eigener Wunsch: sichtbar, solange nicht zurückgezogen
  if v_rm = v_uid and p_created_by = v_uid then
    return p_retracted is null;
  end if;
  -- eigene geheime Idee für den Partner
  if p_created_by = v_uid then
    return true;
  end if;
  -- Wunsch des Partners für sich selbst
  if v_rm = p_created_by and v_rm <> v_uid then
    return true;
  end if;
  -- alles andere (vor allem: Geheimes des Partners für mich) bleibt unsichtbar
  return false;
end;
$$;

-- Darf der angemeldete Nutzer diese Idee bearbeiten?
-- Gemeinsame Ideen: beide. Wünsche und geheime Ideen: nur der Ersteller.
create function private.idea_editable(p_person uuid, p_created_by uuid, p_retracted timestamptz)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.idea_visible(p_person, p_created_by, p_retracted)
     and p_retracted is null
     and (private.person_member(p_person) is null or p_created_by = auth.uid());
$$;

-- Darf der angemeldete Nutzer diese Idee löschen?
create function private.idea_deletable(p_person uuid, p_created_by uuid, p_retracted timestamptz)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_rm  uuid;
begin
  if not private.idea_visible(p_person, p_created_by, p_retracted) then
    return false;
  end if;
  v_rm := private.person_member(p_person);
  -- gemeinsame Idee: beide dürfen löschen
  if v_rm is null then
    return true;
  end if;
  -- eigene geheime Idee für den Partner
  if p_created_by = v_uid and v_rm <> v_uid then
    return true;
  end if;
  -- Wunsch des Partners erst, wenn er zurückgezogen wurde
  if v_rm = p_created_by and v_rm <> v_uid and p_retracted is not null then
    return true;
  end if;
  -- eigener Wunsch wird nicht gelöscht, sondern zurückgezogen (retract_wish)
  return false;
end;
$$;

-- Sichtbarkeit und Bearbeitbarkeit per Ideen-ID (für Unter-Tabellen)
create function private.idea_visible_by_id(p_idea uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select private.idea_visible(i.person_id, i.created_by, i.retracted_at)
       from public.ideas i where i.id = p_idea),
    false);
$$;

create function private.idea_editable_by_id(p_idea uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select private.idea_editable(i.person_id, i.created_by, i.retracted_at)
       from public.ideas i where i.id = p_idea),
    false);
$$;

-- ---------------------------------------------------------------------
-- 3. Schutz-Trigger
--    Sie greifen IMMER, auch wenn die App einen Fehler hätte.
-- ---------------------------------------------------------------------

-- Personen: Verknüpfung mit einem Elternteil ist unveränderlich.
-- Sonst könnte man den Spoilerschutz durch "Entknüpfen" aushebeln.
create function private.persons_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    -- Erlaubt nur als Kaskade einer Geräte-Übertragung: dann existiert
    -- das alte Mitglied nicht mehr.
    if new.member_id is distinct from old.member_id
       and (old.member_id is null or new.member_id is null or private.member_exists(old.member_id)) then
      raise exception 'Die Verknüpfung einer Person mit einem Elternteil kann nicht geändert werden.';
    end if;
    if new.created_by is distinct from old.created_by and private.member_exists(old.created_by) then
      raise exception 'created_by ist unveränderlich.';
    end if;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger persons_guard
  before insert or update on public.persons
  for each row execute function private.persons_guard();

create function private.touch_updated_at()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if old.created_by is not null and private.member_exists(old.created_by) then
      new.created_by := old.created_by;
    end if;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger occasions_touch
  before insert or update on public.occasions
  for each row execute function private.touch_updated_at();

-- Ideen: erzwingt Verschlüsselung für Geschenke an den Partner und
-- verhindert, dass Ideen zwischen Eltern und Kindern verschoben werden.
create function private.ideas_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_rm  uuid;
begin
  if tg_op = 'INSERT' then
    if v_uid is not null and new.created_by is distinct from v_uid then
      raise exception 'Ideen können nur im eigenen Namen angelegt werden.';
    end if;
  else
    if new.created_by is distinct from old.created_by and private.member_exists(old.created_by) then
      raise exception 'created_by ist unveränderlich.';
    end if;
    if new.person_id is distinct from old.person_id
       and (private.person_member(old.person_id) is not null
            or private.person_member(new.person_id) is not null) then
      raise exception 'Ideen für oder von Eltern können keiner anderen Person zugeordnet werden.';
    end if;
    if old.retracted_at is not null and new.retracted_at is distinct from old.retracted_at then
      raise exception 'Ein zurückgezogener Wunsch bleibt zurückgezogen.';
    end if;
    new.created_at := old.created_at;
  end if;

  v_rm := private.person_member(new.person_id);

  if v_rm is not null and v_rm <> new.created_by then
    -- geheime Idee für den Partner: nur verschlüsselter Inhalt erlaubt
    if new.enc is null
       or new.title is not null or new.note is not null or new.url is not null
       or new.shop is not null or new.price_cents is not null or new.details is not null
       or new.priority is not null or new.occasion_id is not null or new.for_birthday
       or new.retracted_at is not null then
      raise exception 'Ideen für den Partner müssen vollständig verschlüsselt sein.';
    end if;
  else
    -- gemeinsame Idee oder eigener Wunsch: Klartext, nie verschlüsselt
    if new.enc is not null or new.title is null then
      raise exception 'Diese Idee braucht einen Titel und darf nicht verschlüsselt sein.';
    end if;
    if v_rm is null and new.retracted_at is not null then
      raise exception 'Nur eigene Wünsche können zurückgezogen werden.';
    end if;
  end if;

  if tg_op = 'UPDATE' and v_rm is not null
     and exists (select 1 from public.idea_co_recipients c where c.idea_id = new.id) then
    raise exception 'Ideen für Eltern können keine weiteren Empfänger haben.';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger ideas_guard
  before insert or update on public.ideas
  for each row execute function private.ideas_guard();

-- Weitere Empfänger: nur bei gemeinsamen Ideen und nur Nicht-Eltern.
create function private.co_recipients_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_main uuid;
begin
  select i.person_id into v_main from public.ideas i where i.id = new.idea_id;
  if v_main is null then
    raise exception 'Idee nicht gefunden.';
  end if;
  if private.person_member(v_main) is not null or private.person_member(new.person_id) is not null then
    raise exception 'Gemeinsame Geschenke sind nur für Personen ohne Login möglich.';
  end if;
  if new.person_id = v_main then
    raise exception 'Diese Person ist bereits Hauptempfänger.';
  end if;
  return new;
end;
$$;

create trigger co_recipients_guard
  before insert or update on public.idea_co_recipients
  for each row execute function private.co_recipients_guard();

-- Status: nur für gemeinsame Ideen. Geschenke an Eltern hinterlassen hier
-- keine Spur, die man im Dashboard sehen könnte.
create function private.gift_status_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_person uuid;
begin
  if tg_op = 'UPDATE' and new.idea_id is distinct from old.idea_id then
    raise exception 'idea_id ist unveränderlich.';
  end if;
  select i.person_id into v_person from public.ideas i where i.id = new.idea_id;
  if v_person is null then
    raise exception 'Idee nicht gefunden.';
  end if;
  if private.person_member(v_person) is not null then
    raise exception 'Der Status von Geschenken für Eltern wird nur verschlüsselt gespeichert.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger gift_status_guard
  before insert or update on public.gift_status
  for each row execute function private.gift_status_guard();

-- ---------------------------------------------------------------------
-- 4. Row Level Security: ohne passende Regel sieht niemand etwas
-- ---------------------------------------------------------------------
alter table public.members            enable row level security;
alter table public.persons            enable row level security;
alter table public.occasions          enable row level security;
alter table public.ideas              enable row level security;
alter table public.idea_co_recipients enable row level security;
alter table public.gift_status        enable row level security;

-- members: lesen alle Mitglieder, ändern nur den eigenen Eintrag.
-- Anlegen nur über join_household, Löschen gar nicht (keine Regel = verboten).
create policy members_select on public.members
  for select to authenticated using (private.is_member());
create policy members_update on public.members
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- persons
create policy persons_select on public.persons
  for select to authenticated using (private.is_member());
create policy persons_insert on public.persons
  for insert to authenticated
  with check (private.is_member() and member_id is null and created_by = auth.uid());
create policy persons_update on public.persons
  for update to authenticated
  using (private.is_member()) with check (private.is_member());
create policy persons_delete on public.persons
  for delete to authenticated
  using (private.is_member() and member_id is null);

-- occasions
create policy occasions_select on public.occasions
  for select to authenticated using (private.is_member());
create policy occasions_insert on public.occasions
  for insert to authenticated
  with check (private.is_member() and created_by = auth.uid());
create policy occasions_update on public.occasions
  for update to authenticated
  using (private.is_member()) with check (private.is_member());
create policy occasions_delete on public.occasions
  for delete to authenticated using (private.is_member());

-- ideas
create policy ideas_select on public.ideas
  for select to authenticated
  using (private.idea_visible(person_id, created_by, retracted_at));
create policy ideas_insert on public.ideas
  for insert to authenticated
  with check (private.is_member() and created_by = auth.uid());
create policy ideas_update on public.ideas
  for update to authenticated
  using (private.idea_editable(person_id, created_by, retracted_at))
  with check (private.idea_editable(person_id, created_by, retracted_at));
create policy ideas_delete on public.ideas
  for delete to authenticated
  using (private.idea_deletable(person_id, created_by, retracted_at));

-- idea_co_recipients
create policy co_select on public.idea_co_recipients
  for select to authenticated using (private.idea_visible_by_id(idea_id));
create policy co_insert on public.idea_co_recipients
  for insert to authenticated with check (private.idea_editable_by_id(idea_id));
create policy co_delete on public.idea_co_recipients
  for delete to authenticated using (private.idea_editable_by_id(idea_id));

-- gift_status
create policy gs_select on public.gift_status
  for select to authenticated using (private.idea_visible_by_id(idea_id));
create policy gs_insert on public.gift_status
  for insert to authenticated
  with check (private.idea_editable_by_id(idea_id) and buyer = auth.uid());
create policy gs_update on public.gift_status
  for update to authenticated
  using (private.idea_editable_by_id(idea_id))
  with check (private.idea_editable_by_id(idea_id) and private.is_member());
create policy gs_delete on public.gift_status
  for delete to authenticated using (private.idea_editable_by_id(idea_id));

-- ---------------------------------------------------------------------
-- 5. Öffentliche Funktion: eigenen Wunsch zurückziehen
--    Der Wunsch verschwindet für einen selbst. Der Partner sieht
--    "zurückgezogen", falls er ihn schon besorgt hat.
-- ---------------------------------------------------------------------
create function public.retract_wish(p_idea uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.ideas%rowtype;
begin
  if v_uid is null or not private.is_member() then
    raise exception 'Nicht angemeldet.';
  end if;
  select * into v_row from public.ideas where id = p_idea for update;
  if not found
     or v_row.created_by <> v_uid
     or private.person_member(v_row.person_id) is distinct from v_uid
     or v_row.retracted_at is not null then
    raise exception 'Wunsch nicht gefunden.';
  end if;
  update public.ideas set retracted_at = now() where id = p_idea;
end;
$$;

-- Eigene Schlüssel-Daten lesen. Die des Partners bleiben unlesbar,
-- damit niemand Material zum Durchprobieren von Geheimwörtern erhält.
create function public.my_key_material()
returns table (key_salt text, key_check text)
language sql stable security definer set search_path = ''
as $$
  select m.key_salt, m.key_check from public.members m where m.user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------
-- 6. Rechte: "anon" (nicht angemeldet) bekommt GAR NICHTS
-- ---------------------------------------------------------------------
revoke all on all tables    in schema public  from anon, public;
revoke all on all functions in schema public  from anon, public;
revoke all on all functions in schema private from anon, public;

revoke all on all tables in schema public from authenticated;
-- members: Schlüssel-Felder des Partners sind nicht lesbar (nur per my_key_material)
grant select (user_id, display_name, created_at) on public.members to authenticated;
grant update (display_name, key_salt, key_check) on public.members to authenticated;
grant select, insert, update, delete on public.persons            to authenticated;
grant select, insert, update, delete on public.occasions          to authenticated;
grant select, insert, update, delete on public.ideas              to authenticated;
grant select, insert, delete         on public.idea_co_recipients to authenticated;
grant select, insert, update, delete on public.gift_status        to authenticated;

grant execute on function private.is_member()                                to authenticated;
grant execute on function private.person_member(uuid)                        to authenticated;
grant execute on function private.member_exists(uuid)                        to authenticated;
grant execute on function private.idea_visible(uuid, uuid, timestamptz)      to authenticated;
grant execute on function private.idea_editable(uuid, uuid, timestamptz)     to authenticated;
grant execute on function private.idea_deletable(uuid, uuid, timestamptz)    to authenticated;
grant execute on function private.idea_visible_by_id(uuid)                   to authenticated;
grant execute on function private.idea_editable_by_id(uuid)                  to authenticated;
grant execute on function public.retract_wish(uuid)                          to authenticated;
grant execute on function public.my_key_material()                          to authenticated;

-- ---------------------------------------------------------------------
-- 7. Haushalt per Code – ganz ohne E-Mail
--
--    Anmeldung: Die App startet eine anonyme Supabase-Sitzung. Wer kein
--    Mitglied ist, sieht leere Listen und kann nichts anlegen.
--
--    Haushaltscode (12 Hex-Zeichen, z. B. 3F9A-0C7E-B214):
--      - wird einmalig per private.set_household_code() erzeugt
--      - die ersten zwei Personen, die ihn eingeben, sind der Haushalt
--      - danach ist er wertlos; Haushalte gründen kann niemand
--
--    Wiederherstellungscode (12 Hex-Zeichen, persönlich):
--      - jedes Mitglied bekommt ihn beim Beitritt genau einmal angezeigt
--      - damit zieht die Mitgliedschaft auf ein neues iPhone um
--        (z. B. nach Verlust, Diebstahl oder gelöschter App);
--        das alte Gerät verliert dabei sofort jeden Zugriff
--      - nach jeder Nutzung gibt es einen neuen Code
--
--    Gespeichert werden nur Hashes, nie die Codes selbst.
--    Fehlversuche: max. 5 pro Sitzung und 20 insgesamt pro Stunde.
-- ---------------------------------------------------------------------
create table private.household (
  id         smallint primary key default 1 check (id = 1),
  code_hash  bytea not null,
  created_at timestamptz not null default now()
);

create table private.recovery_codes (
  user_id    uuid primary key references public.members(user_id) on update cascade on delete cascade,
  code_hash  bytea not null unique,
  created_at timestamptz not null default now()
);

create table private.code_attempts (
  user_id uuid not null,
  kind    text not null check (kind in ('join', 'recover')),
  at      timestamptz not null default now(),
  success boolean not null
);
create index code_attempts_at_idx on private.code_attempts (at);

revoke all on private.household, private.recovery_codes, private.code_attempts
  from public, anon, authenticated;

-- 12 Hex-Zeichen aus 6 Zufallsbytes (48 Bit), Anzeige XXXX-XXXX-XXXX
create function private.new_hex_code()
returns text
language sql volatile set search_path = ''
as $$
  select regexp_replace(upper(encode(extensions.gen_random_bytes(6), 'hex')),
                        '^(.{4})(.{4})(.{4})$', '\1-\2-\3');
$$;

-- Eingabe vereinheitlichen (Groß/klein, Bindestriche, Leerzeichen egal) und hashen
create function private.hash_code(p_code text)
returns bytea
language sql immutable set search_path = ''
as $$
  select extensions.digest(
           convert_to(upper(regexp_replace(coalesce(p_code, ''), '[^0-9A-Fa-f]', '', 'g')), 'UTF8'),
           'sha256');
$$;

create function private.code_locked(p_uid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (select count(*) from private.code_attempts
            where user_id = p_uid and not success and at > now() - interval '1 hour') >= 5
      or (select count(*) from private.code_attempts
            where not success and at > now() - interval '1 hour') >= 20;
$$;

create function private.issue_recovery_code(p_user uuid)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_code text := private.new_hex_code();
begin
  insert into private.recovery_codes (user_id, code_hash)
    values (p_user, private.hash_code(v_code))
  on conflict (user_id) do update
    set code_hash = excluded.code_hash, created_at = now();
  return v_code;
end;
$$;

-- Nur für die Einrichtung (SQL-Editor bzw. Migration): erzeugt den
-- Haushaltscode und gibt ihn EINMAL aus. Geht nur, solange noch niemand
-- Mitglied ist.
create function private.set_household_code()
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_code text := private.new_hex_code();
begin
  if exists (select 1 from public.members) then
    raise exception 'Der Haushalt hat bereits Mitglieder.';
  end if;
  insert into private.household (id, code_hash) values (1, private.hash_code(v_code))
  on conflict (id) do update set code_hash = excluded.code_hash, created_at = now();
  return v_code;
end;
$$;

-- Beitritt. Antwort: {"status": "ok" | "invalid" | "locked" | "full" | "member",
--                     "recovery_code": "..." (nur bei ok)}
create function public.join_household(p_code text, p_name text, p_emoji text default null)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Nicht angemeldet.';
  end if;
  if private.is_member() then
    return jsonb_build_object('status', 'member');
  end if;
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 40 then
    raise exception 'Bitte einen Namen mit 1 bis 40 Zeichen angeben.';
  end if;
  if private.code_locked(v_uid) then
    return jsonb_build_object('status', 'locked');
  end if;
  -- Sperre gegen gleichzeitige Beitritte
  perform 1 from private.household where id = 1 for update;
  if (select count(*) from public.members) >= 2 then
    return jsonb_build_object('status', 'full');
  end if;
  if not exists (select 1 from private.household
                  where id = 1 and code_hash = private.hash_code(p_code)) then
    insert into private.code_attempts (user_id, kind, success) values (v_uid, 'join', false);
    return jsonb_build_object('status', 'invalid');
  end if;

  insert into public.members (user_id, display_name) values (v_uid, trim(p_name));
  insert into public.persons (name, emoji, member_id, created_by)
    values (trim(p_name), p_emoji, v_uid, v_uid);
  insert into private.code_attempts (user_id, kind, success) values (v_uid, 'join', true);
  delete from private.code_attempts where at < now() - interval '7 days';
  return jsonb_build_object('status', 'ok', 'recovery_code', private.issue_recovery_code(v_uid));
end;
$$;

-- Umzug auf ein neues Gerät mit dem persönlichen Wiederherstellungscode.
-- Antwort: {"status": "ok" | "invalid" | "locked" | "member",
--           "recovery_code": "..." (neuer Code, nur bei ok)}
create function public.recover_membership(p_code text)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_old uuid;
begin
  if v_uid is null then
    raise exception 'Nicht angemeldet.';
  end if;
  if private.is_member() then
    return jsonb_build_object('status', 'member');
  end if;
  if private.code_locked(v_uid) then
    return jsonb_build_object('status', 'locked');
  end if;
  select r.user_id into v_old from private.recovery_codes r
    where r.code_hash = private.hash_code(p_code)
    for update;
  if v_old is null then
    insert into private.code_attempts (user_id, kind, success) values (v_uid, 'recover', false);
    return jsonb_build_object('status', 'invalid');
  end if;

  -- Mitgliedschaft samt aller Verknüpfungen auf die neue Sitzung übertragen
  update public.members set user_id = v_uid where user_id = v_old;
  insert into private.code_attempts (user_id, kind, success) values (v_uid, 'recover', true);
  return jsonb_build_object('status', 'ok', 'recovery_code', private.issue_recovery_code(v_uid));
end;
$$;

-- Neuen Wiederherstellungscode erzeugen (der alte wird sofort ungültig)
create function public.renew_recovery_code()
returns text
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_member() then
    raise exception 'Nur Mitglieder.';
  end if;
  return private.issue_recovery_code(auth.uid());
end;
$$;

revoke all on function private.new_hex_code()              from public, anon, authenticated;
revoke all on function private.hash_code(text)             from public, anon, authenticated;
revoke all on function private.code_locked(uuid)           from public, anon, authenticated;
revoke all on function private.issue_recovery_code(uuid)   from public, anon, authenticated;
revoke all on function private.set_household_code()        from public, anon, authenticated;
revoke all on function public.join_household(text, text, text) from public, anon;
revoke all on function public.recover_membership(text)     from public, anon;
revoke all on function public.renew_recovery_code()        from public, anon;
grant execute on function public.join_household(text, text, text) to authenticated;
grant execute on function public.recover_membership(text)         to authenticated;
grant execute on function public.renew_recovery_code()            to authenticated;

-- ---------------------------------------------------------------------
-- 8. Feste Anlässe für alle
-- ---------------------------------------------------------------------
insert into public.occasions (person_id, title, kind, month, day, recurring, created_by) values
  (null, 'Weihnachten', 'fixed', 12, 24, true, null),
  (null, 'Ostern',      'easter', null, null, true, null);

commit;
