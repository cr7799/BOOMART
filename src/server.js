import express from 'express';
import helmet from 'helmet';
import { fileURLToPath } from 'node:url';

const app = express();

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';

app.disable('x-powered-by');

app.use(helmet());
app.use(express.json({ limit: '16kb' }));

const publicDir = fileURLToPath(
  new URL('../public/', import.meta.url)
);

app.use(express.static(publicDir));

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    application: 'BOOMART'
  });
});

app.listen(PORT, HOST, () => {
  console.log(`BOOMART running at http://${HOST}:${PORT}`);
});
