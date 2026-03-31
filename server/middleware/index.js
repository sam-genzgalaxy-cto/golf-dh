import { query } from '../services/database.js';
import dotenv from 'dotenv';

dotenv.config();

export const authMiddleware = (req, res, next) => {
    const authHeader = req.headers["authorization"];
    if (!authHeader) {
        return res.status(401).json({ message: "Authorization header missing." });
    }

    const token = authHeader.split(" ")[1];
    if (!token) {
        return res.status(401).json({ message: "Token missing." });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
    } catch (err) {
        return res.status(401).json({ message: "Invalid token." });
    }
    next();
};


export const adminMiddleware = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required." });
    }
    next();
};

export const subsMiddleware = (req, res, next) => {
    const sub = query('SELECT sub_status FROM users WHERE id = $1', [req.user.userId]);
    if (sub.rows[0].sub_status !== 'active') {
        return res.status(403).json({ message: "Active subscription required." });
    }
    next();
};