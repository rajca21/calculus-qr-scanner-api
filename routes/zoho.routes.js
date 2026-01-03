import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

import {
  getAccessTokenRoute,
  getZohoRequests,
  createZohoRequest,
} from '../controllers/zoho.controller.js';

const router = express.Router();

const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
    cb(null, Date.now() + '-' + safeName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 10 },
});

const maybeUpload = (req, res, next) => {
  const ct = (req.headers['content-type'] || '').toLowerCase();
  if (!ct.includes('multipart/form-data')) return next();

  upload.array('attachments', 10)(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError) {
      return res.status(400).json({
        error: 'Multer error',
        code: err.code,
        message: err.message,
      });
    }

    return res.status(400).json({
      error: 'Upload middleware failed',
      message: err?.message || String(err),
      name: err?.name,
      code: err?.code,
    });
  });
};

router.get('/access-token', getAccessTokenRoute);
router.get('/requests', getZohoRequests);

router.post('/requests', maybeUpload, createZohoRequest);

export default router;
