-- =====================================================================
-- Wish – Tests für Haushaltscode, Beitritt und Geräte-Umzug
-- Datei: supabase/04_beitritt_tests.sql
--
-- Ausführen, solange noch NIEMAND Mitglied ist. Simuliert zwei Eltern,
-- einen Fremden und einen Geräteverlust. Alles wird am Ende
-- zurückgerollt, auch der Test-Haushaltscode. Jede Zeile muss "OK" zeigen.
-- =====================================================================

create temp table if not exists wish_join_results (nr int, test text, ergebnis text);
truncate wish_join_results;

do $$
declare
  a uuid; b uuid; b_new uuid; stranger uuid;
  pb uuid; secret_b uuid;
  code text; rec_b text; rec_b2 text;
  r jsonb;
  n int;
  names text[] := '{}';
  results text[] := '{}';
begin
  if exists (select 1 from public.members) then
    raise exception 'Dieser Test läuft nur vor dem ersten Beitritt.';
  end if;

  begin  -- alles hierin wird am Ende zurückgerollt
    insert into auth.users (id, email) values (gen_random_uuid(), null) returning id into a;
    insert into auth.users (id, email) values (gen_random_uuid(), null) returning id into b;
    insert into auth.users (id, email) values (gen_random_uuid(), null) returning id into b_new;
    insert into auth.users (id, email) values (gen_random_uuid(), null) returning id into stranger;

    code := private.set_household_code();
    names := array_append(names, 'Haushaltscode hat 12 Hex-Zeichen'::text);
    results := array_append(results, (code ~ '^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$')::text);
    names := array_append(names, 'Code ist nur als Hash gespeichert'::text);
    results := array_append(results, (select count(*) = 1 from private.household
      where code_hash <> convert_to(replace(code, '-', ''), 'UTF8'))::text);

    perform set_config('role', 'authenticated', true);

    -- Fremder ohne Code sieht nichts
    perform set_config('request.jwt.claims', json_build_object('sub', stranger, 'role', 'authenticated')::text, true);
    names := array_append(names, 'Ohne Beitritt: leere Listen'::text);
    results := array_append(results, (select count(*) = 0 from public.occasions)::text);
    begin
      insert into public.persons (name, created_by) values ('X', stranger);
      names := array_append(names, 'Ohne Beitritt: nichts anlegbar'::text); results := array_append(results, 'false');
    exception when others then
      names := array_append(names, 'Ohne Beitritt: nichts anlegbar'::text); results := array_append(results, 'true');
    end;

    -- Elternteil A tritt bei (Kleinschreibung, ohne Bindestriche)
    perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
    r := public.join_household(lower(replace(code, '-', '')), 'Elternteil A', '🧔');
    names := array_append(names, 'A tritt mit Code bei und erhält Wiederherstellungscode'::text);
    results := array_append(results, (r->>'status' = 'ok' and (r->>'recovery_code') ~ '^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$')::text);
    names := array_append(names, 'A sieht danach den Haushalt'::text);
    results := array_append(results, (select count(*) = 2 from public.occasions)::text);

    -- Fremder rät: 5 Fehlversuche, dann gesperrt
    perform set_config('request.jwt.claims', json_build_object('sub', stranger, 'role', 'authenticated')::text, true);
    for n in 1 .. 5 loop
      r := public.join_household('000000000000', 'Fremd');
    end loop;
    names := array_append(names, 'Falscher Code wird abgelehnt'::text); results := array_append(results, (r->>'status' = 'invalid')::text);
    r := public.join_household(code, 'Fremd');
    names := array_append(names, 'Nach 5 Fehlversuchen gesperrt, selbst mit richtigem Code'::text); results := array_append(results, (r->>'status' = 'locked')::text);
    r := public.recover_membership('000000000000');
    names := array_append(names, 'Sperre gilt auch für Wiederherstellung'::text); results := array_append(results, (r->>'status' = 'locked')::text);

    -- Elternteil B tritt bei
    perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
    r := public.join_household(code, 'Elternteil B', '👩');
    rec_b := r->>'recovery_code';
    names := array_append(names, 'B tritt bei'::text); results := array_append(results, (r->>'status' = 'ok')::text);
    select id into pb from public.persons where member_id = b;
    insert into public.ideas (person_id, title) values (pb, 'Wunsch von B');

    -- A plant geheim für B
    perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
    insert into public.ideas (person_id, enc) values (pb, 'geheim-von-A') returning id into secret_b;

    -- Haushalt ist voll
    perform set_config('role', 'postgres', true);
    delete from private.code_attempts;
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', json_build_object('sub', stranger, 'role', 'authenticated')::text, true);
    r := public.join_household(code, 'Fremd');
    names := array_append(names, 'Dritte Person kommt nicht hinein'::text); results := array_append(results, (r->>'status' = 'full')::text);
    names := array_append(names, 'Fremder sieht weiterhin nichts'::text);
    results := array_append(results, (select count(*) = 0 from public.persons)::text);

    -- B verliert das iPhone und zieht mit dem Wiederherstellungscode um
    perform set_config('request.jwt.claims', json_build_object('sub', b_new, 'role', 'authenticated')::text, true);
    r := public.recover_membership(rec_b);
    rec_b2 := r->>'recovery_code';
    names := array_append(names, 'Umzug auf neues Gerät klappt'::text); results := array_append(results, (r->>'status' = 'ok')::text);
    names := array_append(names, 'Neues Gerät sieht eigenen Wunsch'::text);
    results := array_append(results, (select count(*) = 1 from public.ideas where title = 'Wunsch von B')::text);
    names := array_append(names, 'Neues Gerät sieht Geheimes von A weiterhin NICHT'::text);
    results := array_append(results, (select count(*) = 0 from public.ideas where id = secret_b)::text);
    names := array_append(names, 'Es gibt einen neuen Wiederherstellungscode'::text);
    results := array_append(results, (rec_b2 is not null and rec_b2 <> rec_b)::text);

    -- altes Gerät hat keinen Zugriff mehr, alter Code ist verbraucht
    perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
    names := array_append(names, 'Altes Gerät sieht nichts mehr'::text);
    results := array_append(results, (select count(*) = 0 from public.persons)::text);
    perform set_config('request.jwt.claims', json_build_object('sub', stranger, 'role', 'authenticated')::text, true);
    r := public.recover_membership(rec_b);
    names := array_append(names, 'Alter Wiederherstellungscode ist ungültig'::text); results := array_append(results, (r->>'status' = 'invalid')::text);

    -- A sieht die geheime Idee noch und B weiterhin als Partner
    perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
    names := array_append(names, 'A sieht eigene geheime Idee nach dem Umzug von B'::text);
    results := array_append(results, (select count(*) = 1 from public.ideas where id = secret_b)::text);
    names := array_append(names, 'Person von B ist auf neues Gerät umgezogen'::text);
    results := array_append(results, (select count(*) = 1 from public.persons where id = pb and member_id = b_new)::text);

    -- Nicht angemeldet
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    perform set_config('role', 'anon', true);
    begin
      perform public.join_household(code, 'x');
      names := array_append(names, 'Ohne Sitzung: kein Beitritt möglich'::text); results := array_append(results, 'false');
    exception when others then
      names := array_append(names, 'Ohne Sitzung: kein Beitritt möglich'::text); results := array_append(results, 'true');
    end;

    raise exception using errcode = 'P0001', message = 'WISH_TEST_ROLLBACK';
  exception
    when raise_exception then
      if sqlerrm <> 'WISH_TEST_ROLLBACK' then
        raise;
      end if;
  end;

  for n in 1 .. coalesce(array_length(names, 1), 0) loop
    insert into wish_join_results values (n, names[n], case when results[n] = 'true' then 'OK' else 'FEHLER' end);
  end loop;
end;
$$;

select nr, test, ergebnis from wish_join_results order by nr;
