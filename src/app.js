import express from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { authRoutes } from './routes/auth.js';
import { taskRoutes } from './routes/tasks.js';
import { agentRoutes } from './routes/agents.js';
import { alertRoutes } from './routes/alerts.js';
import { errorHandler } from './middleware/errorHandler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createApp(db) {
  const app = express();
  app.use(express.json());

  // Static files (dashboard)
  app.use(express.static(join(__dirname, 'public')));

  // Attach db to request for downstream use
  app.use((req, res, next) => {
    req.db = db;
    next();
  });

  // Root — redirect to dashboard
  app.get('/', (req, res) => {
    res.redirect('/dashboard.html');
  });

  // Health check (no auth)
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/tasks', taskRoutes);
  app.use('/api/agents', agentRoutes);
app.use('/api/alerts', alertRoutes);

  // Error handler (must be last)
  app.use(errorHandler);

  return app;
}
