import express from 'express';
import { createReceipts } from '../controllers/receipts.controller.js';

const router = express.Router();

router.post('/', createReceipts);

export default router;
