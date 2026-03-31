import { Pool }  from 'pg';
import dotenv from 'dotenv';

dotenv.config();


const pool = new Pool({
  connectionString: process.env.PG_SUPABASE_STRING,
  ssl: {
    rejectUnauthorized: false, 
  },
});

export const connect_db = async () => {
  try {
    await pool.connect();
    console.log('Connected to the database successfully!');
    setup_DB();
  } catch (err) {
    console.error('Error connecting to the database:', err);
  }
};

export const setup_DB = async () => {
  try {
    await query(`
-- =========================
-- ENUM TYPES
-- =========================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM ('user', 'admin');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sub_plan') THEN
    CREATE TYPE sub_plan AS ENUM ('monthly', 'yearly');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sub_status') THEN
    CREATE TYPE sub_status AS ENUM ('active', 'lapsed', 'canceled');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'draw_mode') THEN
    CREATE TYPE draw_mode AS ENUM ('random', 'weighted');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'draw_status') THEN
    CREATE TYPE draw_status AS ENUM ('pending', 'published', 'simulation');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'match_type') THEN
    CREATE TYPE match_type AS ENUM ('3_match', '4_match', '5_match');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'verify_status') THEN
    CREATE TYPE verify_status AS ENUM ('pending', 'approved', 'rejected');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payout_status') THEN
    CREATE TYPE payout_status AS ENUM ('pending', 'paid');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'txn_type') THEN
    CREATE TYPE txn_type AS ENUM ('subscription', 'charity', 'prize');
  END IF;
END $$;

-- =========================
-- CHARITIES
-- =========================
CREATE TABLE IF NOT EXISTS charities (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  logo_url TEXT,
  is_featured BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  total_received INTEGER DEFAULT 0
);

-- =========================
-- USERS
-- =========================
CREATE TABLE IF NOT EXISTS users (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'user',
  country TEXT CHECK (char_length(country) = 2) DEFAULT 'IN',
  charity_id BIGINT REFERENCES charities(id) ON DELETE SET NULL,
  charity_pct INTEGER DEFAULT 10 CHECK (charity_pct >= 10),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =========================
-- SUBSCRIPTIONS
-- =========================
CREATE TABLE IF NOT EXISTS subscriptions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  stripe_sub_id TEXT UNIQUE,
  stripe_customer_id TEXT,
  plan sub_plan,
  status sub_status,
  amount_pence INTEGER,
  current_period_end TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ
);

-- =========================
-- SCORES
-- =========================
CREATE TABLE IF NOT EXISTS scores (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  value INTEGER CHECK (value BETWEEN 1 AND 45),
  played_at DATE NOT NULL,
  admin_override BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- INDEX
CREATE INDEX IF NOT EXISTS idx_scores_user_date 
ON scores(user_id, played_at);
-- =========================
-- DRAWS
-- =========================
CREATE TABLE IF NOT EXISTS draws (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  month DATE,
  mode draw_mode,
  drawn_numbers INTEGER[],
  pool_total_pence INTEGER,
  jackpot_carried INTEGER,
  status draw_status,
  published_at TIMESTAMPTZ,
  executed_by BIGINT REFERENCES users(id) ON DELETE SET NULL
);

-- =========================
-- WINNERS
-- =========================
CREATE TABLE IF NOT EXISTS winners (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  draw_id BIGINT REFERENCES draws(id) ON DELETE CASCADE,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  match_type match_type,
  prize_pence INTEGER,
  verify_status verify_status,
  proof_url TEXT,
  payout_status payout_status,
  paid_at TIMESTAMPTZ
);

-- =========================
-- TRANSACTIONS
-- =========================
CREATE TABLE IF NOT EXISTS transactions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  type txn_type,
  amount_pence INTEGER,
  stripe_invoice_id TEXT,
  charity_id BIGINT REFERENCES charities(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =========================
-- DRAW CONFIG (SINGLETON)
-- =========================
CREATE TABLE IF NOT EXISTS draw_config (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  mode draw_mode,
  jackpot_balance INTEGER,
  prize_pool_pct INTEGER,
  charity_min_pct INTEGER CHECK (charity_min_pct >= 10),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
      `);
    console.log('Database setup completed successfully!');
  } catch (err) {
    console.error('Error setting up the database:', err);
  }
};


export const query = (text, params) => pool.query(text, params);