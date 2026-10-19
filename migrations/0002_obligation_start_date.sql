-- First collectible date for debts and bills.
-- Null preserves the existing schedule. Schema changes never seed or overwrite
-- personal balances, due dates, or payment amounts.
alter table if exists debts add column if not exists start_date date;
alter table if exists recurring_bills add column if not exists start_date date;
