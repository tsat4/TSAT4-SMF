-- Shop-floor purchase reservations. The usage officer buys the summed quantity.
-- Stock does not change here. Receipt (tx_sto_receipt) is recorded when the goods arrive.

create table if not exists public.tx_sto_reserve (
  id bigint generated always as identity primary key,
  costcenter text not null references public.mt_main_costcenter (costcenter),
  material text not null references public.mt_sto_usage (material),
  qty numeric not null check (qty > 0),
  status text not null default 'open' check (status in ('open', 'ordered')),
  reserved_at timestamptz not null default now(),
  requested_by text not null,
  created_at timestamptz not null default now()
);

alter table public.tx_sto_reserve enable row level security;
