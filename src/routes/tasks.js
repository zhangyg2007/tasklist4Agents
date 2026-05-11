import { Router } from 'express';
import { auth } from '../middleware/auth.js';
import { validateIdParam, requireFields } from '../middleware/validate.js';
import {
  listTasks, getTask, createTask, updateTask, patchTask, deleteTask
} from '../controllers/taskController.js';
import {
  assign, submit, review, createSubtasks
} from '../controllers/agentController.js';

export const taskRoutes = Router();

taskRoutes.use(auth);

taskRoutes.get('/', listTasks);
taskRoutes.post('/', requireFields('title'), createTask);

taskRoutes.get('/:id', validateIdParam, getTask);
taskRoutes.put('/:id', validateIdParam, updateTask);
taskRoutes.patch('/:id', validateIdParam, patchTask);
taskRoutes.delete('/:id', validateIdParam, deleteTask);

// Agent collaboration
taskRoutes.post('/:id/assign', validateIdParam, requireFields('assigned_to'), assign);
taskRoutes.post('/:id/submit', validateIdParam, requireFields('result'), submit);
taskRoutes.post('/:id/review', validateIdParam, requireFields('verdict'), review);
taskRoutes.post('/:id/subtasks', validateIdParam, requireFields('subtasks'), createSubtasks);
