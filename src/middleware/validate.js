export function requireFields(...fields) {
  return (req, res, next) => {
    const missing = fields.filter(f => req.body[f] === undefined || req.body[f] === null);
    if (missing.length > 0) {
      return res.status(400).json({
        error: `Missing required fields: ${missing.join(', ')}`
      });
    }
    next();
  };
}

export function validateEnum(field, allowed) {
  return (req, res, next) => {
    const value = req.body[field] || req.query[field];
    if (value && !allowed.includes(value)) {
      return res.status(400).json({
        error: `${field} must be one of: ${allowed.join(', ')}`
      });
    }
    next();
  };
}

export function validateIdParam(req, res, next) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'Invalid id parameter' });
  }
  req.taskId = id;
  next();
}
