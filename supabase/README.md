# Matt's Money Supabase migrations

This directory records changes to the production budget database in Supabase.
The root migrations/ directory is a separate DATABASE_URL/Neon tooling path;
its deploy-time migrator does not apply this directory.

The app_preferences migration was applied to the existing Matt's Money App
project through the Supabase connection. Its filename matches the recorded
production migration version. It creates only a preference table, its ownership
policies, and a function that merges individual preference keys. It does not
update existing balances, bills, transactions, goals, debts, or settings.

scripts/app-preferences-sql.test.mjs verifies this schema in an isolated
in-memory database, including owner isolation and anonymous access denial.
