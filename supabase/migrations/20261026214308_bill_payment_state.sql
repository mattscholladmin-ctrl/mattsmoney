-- Persist occurrence payment state used by the app and budget snapshot.
alter table public.recurring_bills
  add column if not exists paid_through date,
  add column if not exists partial_paid numeric(12,2),
  add column if not exists partial_for date;
notify pgrst, 'reload schema';
