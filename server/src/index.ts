import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import { authRouter, requireAuth } from './auth';
import { itemsRouter } from './items';
import { HttpError } from './errors';

const app = express();
app.use(express.json());
app.use(authRouter);
app.get('/me', requireAuth, (_req, res) => res.json(res.locals.user));
app.use('/items', itemsRouter);

// One place that turns errors into clean JSON responses
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

export default app;
if (process.env.NODE_ENV !== 'test') {
  app.listen(3000, (err?: Error) => {
    if (err) throw err;
    console.log('API running on http://localhost:3000');
  });
}
