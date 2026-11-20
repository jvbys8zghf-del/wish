-- =====================================================================
-- Wish – Sicherheitstests für Spoilerschutz und Zugriffsrechte
-- Datei: supabase/03_tests.sql
--
-- Spielt beide Eltern, einen Fremden mit Login und einen nicht
-- angemeldeten Besucher durch. Alle Testdaten werden am Ende
-- automatisch zurückgerollt; in der Datenbank bleibt nichts zurück.
-- Ergebnis: eine Tabelle. Jede Zeile muss "OK" zeigen.
-- =====================================================================

create temp table if not exists wish_test_results (nr int, test text, ergebnis text);
truncate wish_test_results;

do $$
declare
  a uuid; b uuid; pa uuid; pb uuid;
  kid uuid; kid2 uuid;
  i_shared uuid; i_wish_a uuid; i_secret_a uuid; i_secret_b uuid; i_wish_b uuid;
  stranger uuid := gen_random_uuid();
  n int;
  names text[] := '{}';
  results text[] := '{}';
begin
  select user_id into a from public.members order by created_at limit 1;
  select user_id into b from public.members order by created_at offset 1 limit 1;
  if a is null or b is null then
    raise exception 'Erst zwei Mitglieder mit 02_mitglieder.sql anlegen.';
  end if;
  select id into pa from public.persons where member_id = a;
  select id into pb from public.persons where member_id = b;

  begin  -- alles hierin wird am Ende zurückgerollt

    ---------------------------------------------------------------- Elternteil A
    perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);

    insert into public.persons (name) values ('Testkind') returning id into kid;
    insert into public.persons (name) values ('Testkind 2') returning id into kid2;
    insert into public.ideas (person_id, title) values (kid, 'Lego') returning id into i_shared;
    insert into public.ideas (person_id, title) values (pa, 'Wunsch von A') returning id into i_wish_a;
    insert into public.ideas (person_id, enc) values (pb, 'verschluesselt-A') returning id into i_secret_a;
    insert into public.gift_status (idea_id, status, paid_cents) values (i_shared, 'bought', 4999);
    insert into public.idea_co_recipients (idea_id, person_id) values (i_shared, kid2);

    names := array_append(names, 'A sieht eigene geheime Idee für B'::text);
    results := array_append(results, (select count(*) = 1 from public.ideas where id = i_secret_a)::text);

    begin
      insert into public.ideas (person_id, title) values (pb, 'Klartext für B');
      names := array_append(names, 'Klartext-Idee für Partner wird abgelehnt'::text); results := array_append(results, 'false');
    exception when others then
      names := array_append(names, 'Klartext-Idee für Partner wird abgelehnt'::text); results := array_append(results, 'true');
    end;

    begin
      insert into public.gift_status (idea_id, status) values (i_wish_a, 'bought');
      names := array_append(names, 'Status an Eltern-Wunsch wird abgelehnt'::text); results := array_append(results, 'false');
    exception when others then
      names := array_append(names, 'Status an Eltern-Wunsch wird abgelehnt'::text); results := array_append(results, 'true');
    end;

    begin
      insert into public.ideas (person_id, title, created_by) values (kid, 'Fremder Name', b);
      names := array_append(names, 'Idee im Namen des Partners wird abgelehnt'::text); results := array_append(results, 'false');
    exception when others then
      names := array_append(names, 'Idee im Namen des Partners wird abgelehnt'::text); results := array_append(results, 'true');
    end;

    begin
      update public.persons set member_id = null where id = pa;
      names := array_append(names, 'Eltern-Verknüpfung lässt sich nicht lösen'::text); results := array_append(results, 'false');
    exception when others then
      names := array_append(names, 'Eltern-Verknüpfung lässt sich nicht lösen'::text); results := array_append(results, 'true');
    end;

    begin
      update public.ideas set person_id = pb where id = i_shared;
      names := array_append(names, 'Kinder-Idee lässt sich nicht auf Partner umhängen'::text); results := array_append(results, 'false');
    exception when others then
      names := array_append(names, 'Kinder-Idee lässt sich nicht auf Partner umhängen'::text); results := array_append(results, 'true');
    end;

    delete from public.persons where id = pa;
    get diagnostics n = row_count;
    names := array_append(names, 'Eltern-Person lässt sich nicht löschen'::text); results := array_append(results, (n = 0)::text);

    begin
      perform key_check from public.members where user_id = b;
      names := array_append(names, 'Schlüsseldaten des Partners nicht lesbar'::text); results := array_append(results, 'false');
    exception when others then
      names := array_append(names, 'Schlüsseldaten des Partners nicht lesbar'::text); results := array_append(results, 'true');
    end;

    ---------------------------------------------------------------- Elternteil B
    perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);

    insert into public.ideas (person_id, enc) values (pa, 'verschluesselt-B') returning id into i_secret_b;
    insert into public.ideas (person_id, title) values (pb, 'Wunsch von B') returning id into i_wish_b;

    names := array_append(names, 'B sieht geheime Idee von A NICHT'::text);
    results := array_append(results, (select count(*) = 0 from public.ideas where id = i_secret_a)::text);

    names := array_append(names, 'B sieht gemeinsame Kinder-Idee'::text);
    results := array_append(results, (select count(*) = 1 from public.ideas where id = i_shared)::text);

    names := array_append(names, 'B sieht Status der Kinder-Idee'::text);
    results := array_append(results, (select count(*) = 1 from public.gift_status where idea_id = i_shared)::text);

    names := array_append(names, 'B sieht Wunsch von A'::text);
    results := array_append(results, (select count(*) = 1 from public.ideas where id = i_wish_a)::text);

    update public.ideas set title = 'Manipuliert' where id = i_wish_a;
    get diagnostics n = row_count;
    names := array_append(names, 'B kann Wunsch von A nicht ändern'::text); results := array_append(results, (n = 0)::text);

    update public.ideas set enc = 'x' where id = i_secret_a;
    get diagnostics n = row_count;
    names := array_append(names, 'B kann geheime Idee von A nicht ändern'::text); results := array_append(results, (n = 0)::text);

    delete from public.ideas where id = i_secret_a;
    get diagnostics n = row_count;
    names := array_append(names, 'B kann geheime Idee von A nicht löschen'::text); results := array_append(results, (n = 0)::text);

    delete from public.ideas where id = i_wish_a;
    get diagnostics n = row_count;
    names := array_append(names, 'B kann aktiven Wunsch von A nicht löschen'::text); results := array_append(results, (n = 0)::text);

    ---------------------------------------------------------------- wieder A
    perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);

    names := array_append(names, 'A sieht geheime Idee von B NICHT'::text);
    results := array_append(results, (select count(*) = 0 from public.ideas where id = i_secret_b)::text);

    names := array_append(names, 'A sieht insgesamt keine Idee, die B heimlich für A plant'::text);
    results := array_append(results, (select count(*) = 0 from public.ideas where person_id = pa and created_by = b)::text);

    perform public.retract_wish(i_wish_a);
    names := array_append(names, 'A kann eigenen Wunsch zurückziehen (danach unsichtbar)'::text);
    results := array_append(results, (select count(*) = 0 from public.ideas where id = i_wish_a)::text);

    begin
      perform public.retract_wish(i_wish_b);
      names := array_append(names, 'A kann Wunsch von B nicht zurückziehen'::text); results := array_append(results, 'false');
    exception when others then
      names := array_append(names, 'A kann Wunsch von B nicht zurückziehen'::text); results := array_append(results, 'true');
    end;

    ---------------------------------------------------------------- wieder B
    perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);

    names := array_append(names, 'B sieht zurückgezogenen Wunsch von A als zurückgezogen'::text);
    results := array_append(results, (select count(*) = 1 from public.ideas where id = i_wish_a and retracted_at is not null)::text);

    delete from public.ideas where id = i_wish_a;
    get diagnostics n = row_count;
    names := array_append(names, 'B kann zurückgezogenen Wunsch löschen'::text); results := array_append(results, (n = 1)::text);

    ---------------------------------------------------------------- Fremder mit Login
    perform set_config('request.jwt.claims', json_build_object('sub', stranger, 'role', 'authenticated')::text, true);

    names := array_append(names, 'Fremder mit Login sieht keine Personen'::text);
    results := array_append(results, (select count(*) = 0 from public.persons)::text);
    names := array_append(names, 'Fremder mit Login sieht keine Ideen'::text);
    results := array_append(results, (select count(*) = 0 from public.ideas)::text);
    names := array_append(names, 'Fremder mit Login sieht keine Mitglieder'::text);
    results := array_append(results, (select count(*) = 0 from public.members)::text);

    begin
      insert into public.persons (name, created_by) values ('Eindringling', stranger);
      names := array_append(names, 'Fremder kann nichts anlegen'::text); results := array_append(results, 'false');
    exception when others then
      names := array_append(names, 'Fremder kann nichts anlegen'::text); results := array_append(results, 'true');
    end;

    ---------------------------------------------------------------- nicht angemeldet
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    perform set_config('role', 'anon', true);

    begin
      perform count(*) from public.ideas;
      names := array_append(names, 'Nicht angemeldet: kein Zugriff auf Ideen'::text); results := array_append(results, 'false');
    exception when others then
      names := array_append(names, 'Nicht angemeldet: kein Zugriff auf Ideen'::text); results := array_append(results, 'true');
    end;

    begin
      perform count(*) from public.persons;
      names := array_append(names, 'Nicht angemeldet: kein Zugriff auf Personen'::text); results := array_append(results, 'false');
    exception when others then
      names := array_append(names, 'Nicht angemeldet: kein Zugriff auf Personen'::text); results := array_append(results, 'true');
    end;

    begin
      perform public.retract_wish(i_wish_b);
      names := array_append(names, 'Nicht angemeldet: keine Funktionen aufrufbar'::text); results := array_append(results, 'false');
    exception when others then
      names := array_append(names, 'Nicht angemeldet: keine Funktionen aufrufbar'::text); results := array_append(results, 'true');
    end;

    -- Alles zurückrollen
    raise exception using errcode = 'P0001', message = 'WISH_TEST_ROLLBACK';
  exception
    when raise_exception then
      if sqlerrm <> 'WISH_TEST_ROLLBACK' then
        raise;
      end if;
  end;

  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);

  for n in 1 .. coalesce(array_length(names, 1), 0) loop
    insert into wish_test_results values (n, names[n], case when results[n] = 'true' then 'OK' else 'FEHLER' end);
  end loop;
end;
$$;

select nr, test, ergebnis from wish_test_results order by nr;
