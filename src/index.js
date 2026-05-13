import { initDb } from './db.js';
import { createApp } from './app.js';
import { retryFailedCallbacks } from './controllers/webhook.js';

const PORT = process.env.PORT || 8080;

const db = initDb();
const app = createApp(db);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// Retry failed callbacks every 30 seconds
setInterval(() => retryFailedCallbacks(db), 30000);
