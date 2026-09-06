-- First collectible date for debts and bills.
-- Null = already mid-cycle (existing behavior).
alter table if exists debts add column if not exists start_date date;
alter table if exists recurring_bills add column if not exists start_date date;

-- Fixture: Friend loan first payment Oct 1 2026. Not late in September.
update debts
set
  start_date = '2026-10-01',
  due_day = 1,
  plan_payment = 750,
  min_payment = 750
where name ilike '%friend%loan%'
  and (start_date is null or start_date <> '2026-10-01' or due_day is distinct from 1);
