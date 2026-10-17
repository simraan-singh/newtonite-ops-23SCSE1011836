INSERT INTO teams (name) VALUES ('Payments'), ('Support'), ('Compliance');

INSERT INTO users (name, email, password_hash)
SELECT n, e, crypt('password123', gen_salt('bf')) FROM (VALUES
  ('Admin','admin@ops.test'),
  ('Pay Lead','pay.lead@ops.test'), ('Pay Member','pay.member@ops.test'), ('Pay Viewer','pay.viewer@ops.test'),
  ('Sup Lead','sup.lead@ops.test'), ('Sup Member','sup.member@ops.test'), ('Sup Viewer','sup.viewer@ops.test'),
  ('Comp Lead','comp.lead@ops.test'), ('Comp Member','comp.member@ops.test'), ('Comp Viewer','comp.viewer@ops.test')
) v(n, e);

INSERT INTO memberships (user_id, team_id, role)
SELECT u.id, t.id, m.role FROM (VALUES
  ('admin@ops.test','Payments','ADMIN'), ('admin@ops.test','Support','ADMIN'), ('admin@ops.test','Compliance','ADMIN'),
  ('pay.lead@ops.test','Payments','LEAD'), ('pay.member@ops.test','Payments','MEMBER'), ('pay.viewer@ops.test','Payments','VIEWER'),
  ('sup.lead@ops.test','Support','LEAD'), ('sup.member@ops.test','Support','MEMBER'), ('sup.viewer@ops.test','Support','VIEWER'),
  ('comp.lead@ops.test','Compliance','LEAD'), ('comp.member@ops.test','Compliance','MEMBER'), ('comp.viewer@ops.test','Compliance','VIEWER'),
  ('pay.member@ops.test','Support','VIEWER')
) m(email, team, role)
JOIN users u ON u.email = m.email
JOIN teams t ON t.name = m.team;

INSERT INTO work_items (title, type, priority, team_id, created_by, created_at)
SELECT 'Sample item #' || g,
  (ARRAY['INCIDENT','CUSTOMER_ISSUE','PAYMENT','COMPLIANCE','TASK'])[1 + g % 5],
  (ARRAY['LOW','MEDIUM','HIGH','URGENT'])[1 + g % 4],
  1 + g % 3, 1, now() - (g || ' minutes')::interval
FROM generate_series(1, 3000) g;
