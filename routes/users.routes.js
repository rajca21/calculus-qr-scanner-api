import express from 'express';
import {
  getUserById,
  resetPassword,
  updateProfileInfo,
} from '../controllers/users.controller.js';

const router = express.Router();

router.get('/:id', getUserById);
router.put('/:id/password', resetPassword);
router.put('/:id/profile', updateProfileInfo);

export default router;
