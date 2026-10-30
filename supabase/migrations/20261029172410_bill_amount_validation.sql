-- Existing amounts were checked before this constraint was introduced.
-- Validate future writes at the database boundary, including connector writes.
alter table public.recurring_bills add constraint recurring_bills_valid_amount
check (amount is not null and amount > 0 and amount <= 90071992547409.91
  and amount not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
  and amount = round(amount, 2));
