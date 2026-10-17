import { Router, Response } from 'express';
import { pool } from './db';
import { requireAuth } from './auth';
import { AuthUser } from './permissions';

// Small read-only lookups the frontend needs: my teams (with my role) and the people in them
export const metaRouter = Router();
metaRouter.use(requireAuth);

const myTeamIds = (res: Response) => Object.keys((res.locals.user as AuthUser).roles).map(Number);

metaRouter.get('/teams', async (_req, res) => {
  const user = res.locals.user as AuthUser;
  const { rows } = await pool.query('SELECT id, name FROM teams WHERE id = ANY($1) ORDER BY name', [myTeamIds(res)]);
  res.json(rows.map(t => ({ ...t, role: user.roles[t.id] })));
});

metaRouter.get('/users', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT DISTINCT u.id, u.name FROM users u
     JOIN memberships m ON m.user_id = u.id
     WHERE m.team_id = ANY($1) ORDER BY u.name`, [myTeamIds(res)]);
  res.json(rows);
});
