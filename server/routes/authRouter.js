import express from 'express';
import { loginUser,registerUser,getUserProfile,updateProfile } from "../controllers/authController.js";
import { authMiddleware} from "../middleware/index.js";
const authRouter = express.Router();

authRouter.post("/register", registerUser);
authRouter.post("/login", loginUser);
authRouter.get("/profile",authMiddleware, getUserProfile);
authRouter.post("/update-profile",authMiddleware, updateProfile);

export default authRouter;