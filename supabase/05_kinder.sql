-- =====================================================================
-- Wish – Kennzeichnung der Kinder (eingespielt als Migration persons_is_child)
-- Datei: supabase/05_kinder.sql
-- =====================================================================

alter table public.persons add column is_child boolean not null default false;
comment on column public.persons.is_child is 'Kind des Haushalts – zählt im Gerechtigkeits-Vergleich';
