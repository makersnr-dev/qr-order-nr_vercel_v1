import pg from 'pg';
const { Pool } = pg;
const url = process.env.DATABASE_URL;
export const pool = new Pool({ connectionString: url, ssl: url && !url.includes('localhost') ? { rejectUnauthorized:false } : false });
export async function withClient(fn){ const c = await pool.connect(); try{ return await fn(c);} finally{ c.release(); } }
export async function migrate(){
  await withClient(async (c)=>{
    await c.query(`
      create table if not exists admin_tables(table_no text primary key, active boolean default true, sort_order integer);
      create table if not exists admin_qr_history(id serial primary key, url text not null, table_no text, created_at timestamptz default now());
      create table if not exists admin_menus(id text primary key, name text not null, price integer not null, active boolean default true, soldout boolean default false, updated_at timestamptz default now());
      create table if not exists admin_daily_codes(code_date date primary key, code text not null, override boolean default false, saved_at timestamptz default now());
      create table if not exists admin_orders(
        id text primary key, order_id text, table_no text, amount integer default 0, status text default '접수',
        created_at timestamptz default now(), cleared boolean default false, payment_key text default '', items jsonb default '[]'::jsonb, refunded_at timestamptz
      );
      create table if not exists admin_refunds(id bigserial primary key, order_id text, amount integer default 0, reason text, pg_payload jsonb, created_at timestamptz default now());
      create table if not exists admin_notifications(id bigserial primary key, order_id text, channel text, sent_at timestamptz default now(), meta jsonb);
      create index if not exists idx_admin_orders_created_at on admin_orders(created_at desc);
      create index if not exists idx_admin_orders_table on admin_orders(table_no);
    `);
  });
}
