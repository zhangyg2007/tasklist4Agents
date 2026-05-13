import { Router } from 'express';
import { auth } from '../middleware/auth.js';
import { validateIdParam } from '../middleware/validate.js';
import { listAlerts, getAlert, updateAlert, reportError } from '../controllers/alertController.js';

export const alertRoutes = Router();

alertRoutes.get('/', auth, listAlerts);
alertRoutes.get('/:id', auth, getAlert);
alertRoutes.patch('/:id', auth, updateAlert);

// Error reporting on a task (creates alert + optionally fix subtask)
alertRoutes.post('/tasks/:id/error', auth, validateIdParam, reportError);
