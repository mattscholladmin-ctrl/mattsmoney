-- Additive only: no existing budget values or payment states are rewritten.
alter table public.recurring_bills
  add column outstanding_amount numeric,
  add column outstanding_through date,
  add column outstanding_as_of date,
  add column outstanding_due_date date,
  add column outstanding_note text,
  add column outstanding_estimated boolean not null default false,
  add constraint recurring_bill_outstanding_valid check (
    (outstanding_amount is null and outstanding_through is null and outstanding_as_of is null and outstanding_due_date is null and outstanding_note is null)
    or
    (outstanding_amount is not null and outstanding_amount>=0 and outstanding_amount<=90071992547409.91
      and outstanding_amount=round(outstanding_amount,2)
      and outstanding_through is not null and outstanding_as_of is not null and outstanding_due_date is not null
      and outstanding_due_date<=outstanding_through and outstanding_through<=outstanding_as_of
      and outstanding_note is not null and length(btrim(outstanding_note)) between 1 and 1500)
  );
