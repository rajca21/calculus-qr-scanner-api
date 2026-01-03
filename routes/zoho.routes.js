import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';

import {
  getAccessTokenRoute,
  getZohoRequests,
  createZohoRequest,
} from '../controllers/zoho.controller.js';

const router = express.Router();

const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const safeName = (file.originalname || 'file').replace(
      /[<>:"/\\|?*\x00-\x1F]/g,
      '_'
    );
    const unique = Date.now() + '-' + safeName;
    cb(null, unique);
  },
});

const upload = multer({
  storage,
  limits: {
    files: 10,
    fileSize: 10 * 1024 * 1024,
  },
});

router.get('/access-token', getAccessTokenRoute);
router.get('/requests', getZohoRequests);

const uploadAttachments = (req, res, next) => {
  upload.array('attachments', 10)(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError) {
      return res.status(400).json({
        error: 'Multer error',
        code: err.code,
        message: err.message,
      });
    }

    return res.status(500).json({
      error: 'Upload middleware failed',
      message: err?.message || String(err),
      name: err?.name,
      code: err?.code,
    });
  });
};

router.post('/requests', uploadAttachments, createZohoRequest);

export default router;
