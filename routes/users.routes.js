import express from 'express';
import {
  deleteUser,
  getUserById,
  resetPassword,
  updateProfileInfo,
} from '../controllers/users.controller.js';

const router = express.Router();

router.get('/:id', getUserById);
router.put('/:id/password', resetPassword);
router.put('/:id/profile', updateProfileInfo);
router.delete('/:id', deleteUser);

export default router;
