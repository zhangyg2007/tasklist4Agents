export function sendCallback(db, taskId, url) {
  const task = db.prepare(
    'SELECT id, title, status, created_at, updated_at FROM tasks WHERE id = ?'
  ).get(taskId);

  if (!task) return;

  const payload = {
    task_id: task.id,
    title: task.title,
    status: task.status,
    action: 'all_subtasks_complete',
    created_at: task.created_at,
    updated_at: task.updated_at
  };

  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5000)
  })
    .then(response => {
      const s = response.ok ? 'sent' : 'failed';
      db.prepare(
        `UPDATE callback_queue SET status = ?, retries = retries + 1, last_error = ?
         WHERE task_id = ? AND url = ? AND status = 'pending'`
      ).run(s, response.statusText, taskId, url);
    })
    .catch(err => {
      db.prepare(
        `UPDATE callback_queue SET status = ?, retries = retries + 1, last_error = ?
         WHERE task_id = ? AND url = ? AND status = 'pending'`
      ).run('failed', err.message, taskId, url);
    });
}

export function getCallbackStatus(db, taskId) {
  return db.prepare(
    'SELECT * FROM callback_queue WHERE task_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(taskId);
}

export function retryFailedCallbacks(db) {
  const pending = db.prepare(
    "SELECT * FROM callback_queue WHERE status = 'failed' AND retries < 3"
  ).all();

  for (const cb of pending) {
    sendCallback(db, cb.task_id, cb.url);
  }
}
