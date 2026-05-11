import { Router } from 'express';
import { auth } from '../middleware/auth.js';
import { listAgents } from '../controllers/agentController.js';

export const agentRoutes = Router();

agentRoutes.get('/', auth, listAgents);
