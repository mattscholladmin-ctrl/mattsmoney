-- Remember a bill the user marked paid, so it stays paid on every device.
alter table if exists recurring_bills add column if not exists paid_through date;
