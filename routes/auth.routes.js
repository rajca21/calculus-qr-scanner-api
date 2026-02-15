import express from 'express';
import {
  loginUser,
  logoutUser,
  registerUser,
  validateToken,
} from '../controllers/auth.controller.js';

const router = express.Router();

router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/logout', logoutUser);
router.post('/validate', validateToken);

export default router;
