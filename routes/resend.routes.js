import express from 'express';
import multer from 'multer';
import { sendEmailViaResend } from '../controllers/resend.controller.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024,
    files: 10,
  },
});

router.post('/send', upload.array('attachments', 10), sendEmailViaResend);

export default router;
