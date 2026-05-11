import express from 'express';
import { authRoutes } from './routes/auth.js';
import { taskRoutes } from './routes/tasks.js';
import { agentRoutes } from './routes/agents.js';
import { errorHandler } from './middleware/errorHandler.js';

export function createApp(db) {
  const app = express();
  app.use(express.json());

  // Attach db to request for downstream use
  app.use((req, res, next) => {
    req.db = db;
    next();
  });

  // Health check (no auth)
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/tasks', taskRoutes);
  app.use('/api/agents', agentRoutes);

  // Error handler (must be last)
  app.use(errorHandler);

  return app;
}
