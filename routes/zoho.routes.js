import express from 'express';
import {
  getAccessTokenRoute,
  getZohoRequests,
  createZohoRequest,
} from '../controllers/zoho.controller.js';

const router = express.Router();

router.get('/access-token', getAccessTokenRoute);
router.get('/requests', getZohoRequests);
router.post('/requests', createZohoRequest);

export default router;
