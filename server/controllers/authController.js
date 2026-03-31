import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { sendEmail } from '../services/mailer.js';

dotenv.config();

export const registerUser = async (req, res) => {
    const { email , password, full_name } = req.body;

    if(!email || !password || !full_name){
        return res.status(400).json({ message: "Email, password and full name are required." });
    };

    try {
        const existingUser = await query('SELECT * FROM users WHERE email = $1', [email]);
        if(existingUser.rows.length > 0){
            return res.status(400).json({ message: "User already exists." });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = await query('INSERT INTO users (email, password, full_name) VALUES ($1, $2, $3) RETURNING *', [email, hashedPassword, full_name]);
        sendEmail(email, "Welcome to our platform!", `Hello ${full_name},\n\nThank you for registering on our platform! We're excited to have you on board.\n\nBest regards,\nThe Team`)
        const token = jwt.sign({ userId: newUser.rows[0].id,role:newUser.rows[0].role }, process.env.JWT_SECRET, { expiresIn: '1h' });
        res.status(201).json({ token });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error." });
    }
};

export const loginUser = async (req, res) => {
    const { email, password } = req.body;
    if(!email || !password){
        return res.status(400).json({ message: "Email and password are required." });
    }
    const user = await query('SELECT * FROM users WHERE email = $1', [email]);
    if(user.rows.length === 0){
        return res.status(400).json({ message: "Invalid credentials." });
    }
    const validPassword = await bcrypt.compare(password, user.rows[0].password);
    if(!validPassword){
        return res.status(400).json({ message: "Invalid credentials." });
    }
    const token = jwt.sign({ userId: user.rows[0].id,role:user.rows[0].role }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.json({ token });
};

export const getUserProfile = async (req, res) => {
    const userId = req.user.userId;
    try {
        const user = await query('SELECT id, email, full_name, role,country,charity_id,charity_pct FROM users WHERE id = $1', [userId]);
        if(user.rows.length === 0){
            return res.status(404).json({ message: "User not found." });
        }
        res.json(user.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error." });
    }
};

export const updateProfile = async (req, res) => {
    const userId = req.user.userId;
    const details = req.body;
    try {
        const user = await query('SELECT id FROM users WHERE id = $1', [userId]);
        if(user.rows.length === 0){
            return res.status(404).json({ message: "User not found." });
        }
        const fields = [];
        const values = [];
        let index = 1;
        for(const key in details){
            fields.push(`${key} = $${index}`);
            values.push(details[key]);
            index++;
        }
        values.push(userId);
        await query(`UPDATE users SET ${fields.join(', ')} WHERE id = $${index}`, values);
        res.json({ message: "Profile updated successfully." });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error." });
    }
};