-- Unknown available cash is different from zero. Existing values are unchanged.
alter table public.balance_entries alter column balance drop not null;
comment on column public.balance_entries.balance is 'Available cash when known; NULL when the bank does not provide it. Never substitute current balance for available cash.';
