-- Usage: monthly purchase rights, and a borrow that is repaid by buying back into the lender.
-- Run on Mx Data. The server records stock changes; these tables only store the documents.

create table if not exists public.tx_sto_receipt (
  id bigint generated always as identity primary key,
  costcenter text not null references public.mt_main_costcenter (costcenter),
  material text not null references public.mt_sto_usage (material),
  qty numeric not null check (qty > 0),
  kind text not null check (kind in ('purchase', 'replacement')),
  borrow_id bigint,
  received_at timestamptz not null default now(),
  received_by text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.tx_sto_borrow (
  id bigint generated always as identity primary key,
  borrower_costcenter text not null references public.mt_main_costcenter (costcenter),
  lender_costcenter text not null references public.mt_main_costcenter (costcenter),
  material text not null references public.mt_sto_usage (material),
  qty numeric not null check (qty > 0),
  status text not null default 'open' check (status in ('open', 'replaced')),
  borrowed_at timestamptz not null default now(),
  borrowed_by text not null,
  created_at timestamptz not null default now(),
  check (borrower_costcenter <> lender_costcenter)
);

alter table public.tx_sto_receipt
  drop constraint if exists tx_sto_receipt_borrow_id_fkey;
alter table public.tx_sto_receipt
  add constraint tx_sto_receipt_borrow_id_fkey
  foreign key (borrow_id) references public.tx_sto_borrow (id);

alter table public.tx_sto_receipt enable row level security;
alter table public.tx_sto_borrow enable row level security;
