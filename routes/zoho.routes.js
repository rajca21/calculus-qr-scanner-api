import express from 'express';
import {
  getAccessTokenRoute,
  getZohoRequests,
} from '../controllers/zoho.controller.js';

const router = express.Router();

router.get('/access-token', getAccessTokenRoute);
router.get('/requests', getZohoRequests);

export default router;
