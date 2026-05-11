import { User } from '../models/User.js';

export function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }

  const token = header.slice(7);
  if (!token) {
    return res.status(401).json({ error: 'Token is required' });
  }

  const userModel = new User(req.db);
  const user = userModel.findByToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  req.user = user;
  next();
}
