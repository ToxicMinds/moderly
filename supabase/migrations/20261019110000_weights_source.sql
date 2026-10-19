-- Where a weigh-in came from: null for one typed or sent in Moderly, or
-- 'import:<batch>' for a history brought from another app. A batch can be
-- undone in one tap, and a day typed in Moderly always replaces an imported one.
alter table public.weights add column if not exists source text;
