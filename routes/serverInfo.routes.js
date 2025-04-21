import express from 'express';
import {
  getDBServerDateTime,
  getWebServerDateTime,
} from '../controllers/serverInfo.controller.js';

const router = express.Router();

router.get('/ws', getWebServerDateTime);
router.get('/db', getDBServerDateTime);

export default router;
