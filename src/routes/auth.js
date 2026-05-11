import { Router } from 'express';
import { register, me } from '../controllers/authController.js';
import { auth } from '../middleware/auth.js';
import { requireFields, validateEnum } from '../middleware/validate.js';

export const authRoutes = Router();

authRoutes.post('/register',
  requireFields('username'),
  validateEnum('role', ['human', 'agent']),
  register
);

authRoutes.get('/me', auth, me);
