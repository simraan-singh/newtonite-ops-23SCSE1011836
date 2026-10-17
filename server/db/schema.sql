CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL
);

CREATE TABLE teams (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE memberships (
  user_id INT NOT NULL REFERENCES users(id),
  team_id INT NOT NULL REFERENCES teams(id),
  role TEXT NOT NULL CHECK (role IN ('VIEWER','MEMBER','LEAD','ADMIN')),
  PRIMARY KEY (user_id, team_id)
);

CREATE TABLE work_items (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL CHECK (type IN ('INCIDENT','CUSTOMER_ISSUE','PAYMENT','COMPLIANCE','TASK')),
  priority TEXT NOT NULL CHECK (priority IN ('LOW','MEDIUM','HIGH','URGENT')),
  status TEXT NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN','IN_PROGRESS','AWAITING_APPROVAL','RESOLVED','CLOSED')),
  team_id INT NOT NULL REFERENCES teams(id),
  assignee_id INT REFERENCES users(id),
  created_by INT NOT NULL REFERENCES users(id),
  due_date DATE,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_items_team_status ON work_items (team_id, status, priority);
CREATE INDEX idx_items_assignee ON work_items (assignee_id);
CREATE INDEX idx_items_created ON work_items (created_at DESC, id DESC);

CREATE TABLE activity_events (
  id BIGSERIAL PRIMARY KEY,
  item_id INT NOT NULL REFERENCES work_items(id),
  actor_id INT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  from_value TEXT,
  to_value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_activity_item ON activity_events (item_id, created_at);

CREATE TABLE comments (
  id SERIAL PRIMARY KEY,
  item_id INT NOT NULL REFERENCES work_items(id),
  author_id INT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE idempotency_keys (
  key TEXT NOT NULL,
  user_id INT NOT NULL REFERENCES users(id),
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (key, user_id)
);
