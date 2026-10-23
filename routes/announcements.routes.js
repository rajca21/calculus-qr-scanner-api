import express from 'express';
import {
  getAnnouncements,
  markAnnouncementRead,
} from '../controllers/announcements.controller.js';

const router = express.Router();

router.get('/:userId', getAnnouncements);
router.put('/:id/read', markAnnouncementRead);

export default router;
