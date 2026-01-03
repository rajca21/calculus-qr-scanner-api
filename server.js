import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';

import serverInfoRouter from './routes/serverInfo.routes.js';
import authRouter from './routes/auth.routes.js';
import usersRouter from './routes/users.routes.js';
import receiptsRouter from './routes/receipts.routes.js';
import zohoRoutes from './routes/zoho.routes.js';

const app = express();
const port = process.env.PORT || 8000;

const uploadsDir = path.join(process.cwd(), 'uploads');
try {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log('✅ uploads/ created:', uploadsDir);
  }
} catch (e) {
  console.error('❌ Cannot create uploads/:', e);
}

app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use('/api/info', serverInfoRouter);
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/receipts', receiptsRouter);
app.use('/api/zoho', zohoRoutes);

app.use((req, res) => {
  return res.status(404).json({
    error: 'Not Found',
    path: req.originalUrl,
    method: req.method,
  });
});

app.use((err, req, res, next) => {
  console.error('UNHANDLED ERROR:', err);
  const status = err?.status || err?.statusCode || 500;
  return res.status(status).json({
    error: 'Internal server error',
    message: err?.message || String(err),
    name: err?.name,
    code: err?.code,
    stack: process.env.NODE_ENV === 'development' ? err?.stack : undefined,
  });
});

app.listen(port, () => {
  console.log(`Server je pokrenut na portu ${port}`);
});
