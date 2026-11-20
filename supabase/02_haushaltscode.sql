-- =====================================================================
-- Wish – Haushaltscode erzeugen
-- Datei: supabase/02_haushaltscode.sql
--
-- Erzeugt den 12-stelligen Haushaltscode und zeigt ihn EINMAL an.
-- Geht nur, solange noch niemand Mitglied ist. Erneut ausführen
-- ersetzt den alten Code.
-- =====================================================================

select private.set_household_code() as haushaltscode;
