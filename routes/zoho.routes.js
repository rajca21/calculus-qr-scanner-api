import express from 'express';
import {
  getAccessTokenRoute,
  getZohoRequests,
  createZohoRequest,
  getZohoRequestTasks,
  getZohoRequestWorklogs,
} from '../controllers/zoho.controller.js';

const router = express.Router();

router.get('/access-token', getAccessTokenRoute);
router.get('/requests', getZohoRequests);
router.post('/requests', createZohoRequest);
router.get('/requests/:requestId/tasks', getZohoRequestTasks);
router.get(
  '/requests/:requestId/tasks/:taskId/worklogs',
  getZohoRequestWorklogs,
);

export default router;
