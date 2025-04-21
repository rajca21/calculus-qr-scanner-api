import express from 'express';
import cors from 'cors';
import serverInfoRouter from './routes/serverInfo.routes.js';

const app = express();
const port = process.env.PORT || 8000;

app.use(cors());
app.use(express.json());

app.use('/api/info', serverInfoRouter);

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
