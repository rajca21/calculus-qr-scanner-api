import express from 'express';
import multer from 'multer';
import {
  getAccessTokenRoute,
  getZohoRequests,
  createZohoRequest,
} from '../controllers/zoho.controller.js';

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + file.originalname;
    cb(null, unique);
  },
});

const upload = multer({ storage });

router.get('/access-token', getAccessTokenRoute);
router.get('/requests', getZohoRequests);

router.post('/requests', upload.array('attachments', 10), createZohoRequest);

export default router;
