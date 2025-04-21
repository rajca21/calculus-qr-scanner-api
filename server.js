import express from 'express';
import cors from 'cors';
import serverInfoRouter from './routes/serverInfo.routes.js';
import authRouter from './routes/auth.routes.js';
import usersRouter from './routes/users.routes.js';
import receiptsRouter from './routes/receipts.routes.js';

const app = express();
const port = process.env.PORT || 8000;

app.use(cors());
app.use(express.json());

app.use('/api/info', serverInfoRouter);
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/receipts', receiptsRouter);

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
