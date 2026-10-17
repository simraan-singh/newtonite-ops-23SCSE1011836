import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from './db';

export const authRouter = Router();

authRouter.post('/auth/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password ?? '', user.password_hash))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, { expiresIn: '8h' });
  res.json({ token, user: { id: user.id, name: user.name } });
});

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing token' });
  try {
    const { userId } = jwt.verify(header.slice(7), process.env.JWT_SECRET!) as { userId: number };
    const { rows } = await pool.query(
      'SELECT team_id, role FROM memberships WHERE user_id = $1', [userId]);
    res.locals.user = { id: userId, roles: Object.fromEntries(rows.map(r => [r.team_id, r.role])) };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}
