-- SELECT FOR UPDATE requires UPDATE on at least one column, even when no value is changed.
-- Only the NOLOGIN definer gets this grant; runtime roles still use the bounded reservation function.
GRANT UPDATE(id) ON research_campaigns TO ulysse_definer;
