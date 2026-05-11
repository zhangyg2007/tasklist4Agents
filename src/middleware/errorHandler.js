export function errorHandler(err, req, res, next) {
  console.error(`[${new Date().toISOString()}] ${err.message}`);
  if (err.stack) {
    console.error(err.stack);
  }

  // JSON parse error
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON in request body' });
  }

  // SQLite constraint errors
  if (err.message && err.message.includes('CHECK constraint failed')) {
    const match = err.message.match(/CHECK constraint failed: (\w+)/);
    const field = match?.[1] || 'unknown';
    return res.status(400).json({ error: `Constraint violation: ${field}` });
  }

  // SQLite foreign key errors
  if (err.message && err.message.includes('FOREIGN KEY constraint failed')) {
    return res.status(400).json({ error: 'Referenced record does not exist' });
  }

  res.status(500).json({ error: 'Internal server error' });
}
