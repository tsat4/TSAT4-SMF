import { createApp } from './server/app.js';
import { bootstrap } from './server/core/auth.js';

const PORT = Number(process.env.PORT || 3000);

createApp().listen(PORT, '0.0.0.0', async () => {
  console.log(`SMF listening on ${PORT}`);
  try {
    await bootstrap();
  } catch {
    console.error('bootstrap failed');
  }
});
