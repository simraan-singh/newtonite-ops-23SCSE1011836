import 'dotenv/config';
import express from 'express';
import { authRouter, requireAuth } from './auth';

const app = express();
app.use(express.json());
app.use(authRouter);

app.get('/me', requireAuth, (_req, res) => res.json(res.locals.user));

export default app;
if (process.env.NODE_ENV !== 'test') {
  app.listen(3000, (err?: Error) => {
    if (err) throw err;
    console.log('API running on http://localhost:3000');
  });
}
