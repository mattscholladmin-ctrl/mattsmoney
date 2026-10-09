-- A partial payment toward one due date. The bill amount stays. The due date stays.
alter table if exists recurring_bills add column if not exists partial_paid numeric;
alter table if exists recurring_bills add column if not exists partial_for date;
