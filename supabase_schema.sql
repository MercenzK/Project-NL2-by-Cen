-- ===== รันสคริปต์นี้ใน Supabase > SQL Editor (ครั้งเดียว) =====
-- ตารางเก็บผลการทำข้อสอบรายคน (แต่ละคนเห็นเฉพาะของตัวเอง ผ่าน Row Level Security)

create table if not exists public.attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  quiz_id text not null,
  quiz_title text,
  score int not null,
  total int not null,
  answers jsonb,
  created_at timestamptz not null default now()
);

alter table public.attempts enable row level security;

-- ให้ผู้ใช้เห็น/เพิ่ม/ลบเฉพาะแถวของตัวเอง
drop policy if exists "attempts_select_own" on public.attempts;
create policy "attempts_select_own" on public.attempts
  for select using (auth.uid() = user_id);

drop policy if exists "attempts_insert_own" on public.attempts;
create policy "attempts_insert_own" on public.attempts
  for insert with check (auth.uid() = user_id);

drop policy if exists "attempts_delete_own" on public.attempts;
create policy "attempts_delete_own" on public.attempts
  for delete using (auth.uid() = user_id);

create index if not exists attempts_user_created_idx
  on public.attempts (user_id, created_at desc);
