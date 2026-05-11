import { User } from '../models/User.js';

export function register(req, res) {
  const { username, role, source, capabilities, callback_url } = req.body;
  const userModel = new User(req.db);
  const result = userModel.register({ username, role, source, capabilities, callback_url });

  if (result.error) {
    return res.status(result.status).json({ error: result.error });
  }

  res.status(201).json({
    id: result.id,
    username: result.username,
    token: result.token,
    role: result.role,
    source: result.source,
    capabilities: JSON.parse(result.capabilities),
    callback_url: result.callback_url
  });
}

export function me(req, res) {
  const user = { ...req.user };
  try {
    user.capabilities = typeof user.capabilities === 'string'
      ? JSON.parse(user.capabilities)
      : user.capabilities;
  } catch {
    user.capabilities = [];
  }
  res.json(user);
}
