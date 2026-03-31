import { query } from '../services/database.js';
import { sendEmail } from '../services/mailer.js';

const MIN_NUMBER = 1;
const MAX_NUMBER = 45;
const PICK_COUNT = 5;

const pickUniqueRandomNumbers = (count = PICK_COUNT, min = MIN_NUMBER, max = MAX_NUMBER) => {
    const selected = new Set();

    while (selected.size < count) {
        const n = Math.floor(Math.random() * (max - min + 1)) + min;
        selected.add(n);
    }

    return Array.from(selected).sort((a, b) => a - b);
};

const pickWeightedNumbers = async () => {
    const scoreRows = await query(
        `SELECT value, COUNT(*)::int AS freq
         FROM scores
         GROUP BY value
         HAVING value BETWEEN $1 AND $2`,
        [MIN_NUMBER, MAX_NUMBER]
    );

    const weights = new Map();
    for (let n = MIN_NUMBER; n <= MAX_NUMBER; n++) {
        weights.set(n, 1);
    }

    for (const row of scoreRows.rows) {
        const value = Number(row.value);
        const freq = Number(row.freq);
        if (Number.isInteger(value) && value >= MIN_NUMBER && value <= MAX_NUMBER) {
            weights.set(value, Math.max(1, freq));
        }
    }

    const picks = [];
    const available = Array.from(weights.keys());

    while (picks.length < PICK_COUNT && available.length > 0) {
        const totalWeight = available.reduce((sum, n) => sum + (weights.get(n) || 1), 0);
        let threshold = Math.random() * totalWeight;
        let chosenIndex = 0;

        for (let i = 0; i < available.length; i++) {
            threshold -= (weights.get(available[i]) || 1);
            if (threshold <= 0) {
                chosenIndex = i;
                break;
            }
        }

        picks.push(available[chosenIndex]);
        available.splice(chosenIndex, 1);
    }

    return picks.sort((a, b) => a - b);
};

const getConfiguredDrawMode = async () => {
    const config = await query('SELECT mode FROM draw_config ORDER BY updated_at DESC LIMIT 1');
    if (config.rows.length === 0 || !config.rows[0].mode) {
        return 'random';
    }
    return config.rows[0].mode;
};

const generateNumbersByMode = async (mode) => {
    if (mode === 'weighted') {
        return pickWeightedNumbers();
    }
    return pickUniqueRandomNumbers();
};

const notifyDrawResults = async (drawRecord) => {
    try {
        const users = await query('SELECT email, full_name FROM users WHERE email IS NOT NULL');
        if (users.rows.length === 0) {
            return;
        }

        const numbers = (drawRecord.drawn_numbers || []).join(', ');
        const monthText = drawRecord.month ? new Date(drawRecord.month).toISOString().slice(0, 7) : 'this month';

        await Promise.allSettled(
            users.rows.map((user) =>
                sendEmail(
                    user.email,
                    `Draw Results Published - ${monthText}`,
                    `Hi ${user.full_name || 'there'},\n\nThe latest draw has been published.\nWinning numbers: ${numbers}\nMode: ${drawRecord.mode}\n\nGood luck!`,
                    `<p>Hi ${user.full_name || 'there'},</p><p>The latest draw has been published.</p><p><strong>Winning numbers:</strong> ${numbers}<br/><strong>Mode:</strong> ${drawRecord.mode}</p><p>Good luck!</p>`
                )
            )
        );
    } catch (notifyErr) {
        console.error('Draw results email notification failed:', notifyErr);
    }
};

export const getDraws = async (req, res) => {
    try {
        const draws = await query('SELECT id, name, mode, status FROM draws ORDER BY created_at DESC');
        res.json(draws.rows);
    }catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error." });
    }
};

export const getDrawById = async (req, res) => {
    const { drawId } = req.params;
    try {
        const draw = await query('SELECT id, name, mode, status FROM draws WHERE id = $1', [drawId]);
        if(draw.rows.length === 0){
            return res.status(404).json({ message: "Draw not found." });
        }
        res.json(draw.rows[0]);
    }catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error." });
    }
};

export const currentDraw = async (req, res) => {
    try {
        const draw = await query('SELECT id, name, mode, status FROM draws WHERE status = $1 ORDER BY created_at DESC LIMIT 1', ['published']);
        if(draw.rows.length === 0){
            return res.status(404).json({ message: "No active draw found." });
        }
        res.json(draw.rows[0]);
    }catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error." });
    }
};


// ADMIN CONTROLLERS

export const simulateDraw = async (req, res) => {
    try {
        const mode = await getConfiguredDrawMode();
        const drawnNumbers = await generateNumbersByMode(mode);

        return res.json({
            mode,
            drawn_numbers: drawnNumbers,
            status: 'simulation'
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Server error.' });
    }
};

export const executeDraw = async (req, res) => {
    try {
        const mode = await getConfiguredDrawMode();
        const drawnNumbers = await generateNumbersByMode(mode);
        const executor = req.user?.userId || null;

        const draw = await query(
            `INSERT INTO draws (month, mode, drawn_numbers, pool_total_pence, jackpot_carried, status, published_at, executed_by)
             VALUES (date_trunc('month', NOW())::date, $1, $2, 0, 0, 'published', NOW(), $3)
             RETURNING id, month, mode, drawn_numbers, status, published_at, executed_by`,
            [mode, drawnNumbers, executor]
        );

        await notifyDrawResults(draw.rows[0]);

        return res.status(201).json({
            message: 'Draw executed and published successfully.',
            draw: draw.rows[0]
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Server error.' });
    }
};

export const updateDrawConfig = async (req, res) => {
    const { mode } = req.body;

    if (!mode || !['random', 'weighted'].includes(mode)) {
        return res.status(400).json({ message: "Mode is required and must be either 'random' or 'weighted'." });
    }

    try {
        const updated = await query(
            `INSERT INTO draw_config (id, mode, jackpot_balance, prize_pool_pct, charity_min_pct, updated_at)
             VALUES (1, $1, 0, 60, 10, NOW())
             ON CONFLICT (id)
             DO UPDATE SET mode = EXCLUDED.mode, updated_at = NOW()
             RETURNING id, mode, updated_at`,
            [mode]
        );

        return res.json({
            message: 'Draw config updated successfully.',
            config: updated.rows[0]
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Server error.' });
    }
};

