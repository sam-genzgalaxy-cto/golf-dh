import { query } from '../services/database.js';

const parseBoolean = (value) => {
    if (value === undefined) return undefined;
    if (typeof value === 'boolean') return value;
    if (String(value).toLowerCase() === 'true') return true;
    if (String(value).toLowerCase() === 'false') return false;
    return undefined;
};

export const listCharities = async (req, res) => {
    try {
        const {
            search,
            category,
            is_featured,
            is_active,
            page = 1,
            limit = 10
        } = req.query;

        const pageNum = Math.max(1, Number(page) || 1);
        const limitNum = Math.min(100, Math.max(1, Number(limit) || 10));
        const offset = (pageNum - 1) * limitNum;

        const filters = [];
        const values = [];
        let index = 1;

        if (search) {
            filters.push(`(name ILIKE $${index} OR description ILIKE $${index})`);
            values.push(`%${search}%`);
            index++;
        }

        if (category) {
            filters.push(`category = $${index}`);
            values.push(category);
            index++;
        }

        const featured = parseBoolean(is_featured);
        if (featured !== undefined) {
            filters.push(`is_featured = $${index}`);
            values.push(featured);
            index++;
        }

        const active = parseBoolean(is_active);
        if (active !== undefined) {
            filters.push(`is_active = $${index}`);
            values.push(active);
            index++;
        }

        const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

        const countResult = await query(
            `SELECT COUNT(*)::int AS total FROM charities ${whereClause}`,
            values
        );

        const dataResult = await query(
            `SELECT id, name, description, category, logo_url, is_featured, is_active, total_received
             FROM charities
             ${whereClause}
             ORDER BY is_featured DESC, id DESC
             LIMIT $${index} OFFSET $${index + 1}`,
            [...values, limitNum, offset]
        );

        return res.json({
            data: dataResult.rows,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total: countResult.rows[0].total
            }
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Server error.' });
    }
};

export const getCharityById = async (req, res) => {
    const { id } = req.params;

    try {
        const charity = await query(
            `SELECT id, name, description, category, logo_url, is_featured, is_active, total_received
             FROM charities
             WHERE id = $1`,
            [id]
        );

        if (charity.rows.length === 0) {
            return res.status(404).json({ message: 'Charity not found.' });
        }

        return res.json(charity.rows[0]);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Server error.' });
    }
};

export const selectUserCharity = async (req, res) => {
    const userId = req.user.userId;
    const charityId = req.body.charity_id ?? req.body.charityId;

    if (!charityId) {
        return res.status(400).json({ message: 'charity_id is required.' });
    }

    try {
        const charity = await query('SELECT id FROM charities WHERE id = $1 AND is_active = true', [charityId]);
        if (charity.rows.length === 0) {
            return res.status(404).json({ message: 'Charity not found.' });
        }

        await query('UPDATE users SET charity_id = $1 WHERE id = $2', [charityId, userId]);

        return res.json({ message: 'Charity selected successfully.' });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Server error.' });
    }
};

export const updateContribution = async (req, res) => {
    const userId = req.user.userId;
    const charityPct = Number(req.body.charity_pct ?? req.body.charityPct);

    if (!Number.isFinite(charityPct)) {
        return res.status(400).json({ message: 'charity_pct is required.' });
    }

    if (charityPct < 10 || charityPct > 100) {
        return res.status(400).json({ message: 'charity_pct must be between 10 and 100.' });
    }

    try {
        await query('UPDATE users SET charity_pct = $1 WHERE id = $2', [charityPct, userId]);
        return res.json({ message: 'Contribution percentage updated successfully.' });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Server error.' });
    }
};

export const donateToCharity = async (req, res) => {
    const userId = req.user.userId;
    const charityId = req.body.charity_id ?? req.body.charityId;
    const amountPence = Number(req.body.amount_pence ?? req.body.amountPence);

    if (!charityId || !Number.isFinite(amountPence) || amountPence <= 0) {
        return res.status(400).json({ message: 'charity_id and a positive amount_pence are required.' });
    }

    try {
        const charity = await query('SELECT id FROM charities WHERE id = $1 AND is_active = true', [charityId]);
        if (charity.rows.length === 0) {
            return res.status(404).json({ message: 'Charity not found.' });
        }

        await query('UPDATE charities SET total_received = COALESCE(total_received, 0) + $1 WHERE id = $2', [amountPence, charityId]);
        await query(
            `INSERT INTO transactions (user_id, type, amount_pence, charity_id)
             VALUES ($1, 'charity', $2, $3)`,
            [userId, amountPence, charityId]
        );

        return res.status(201).json({ message: 'Donation recorded successfully.' });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Server error.' });
    }
};

export const addCharity = async (req, res) => {
    const {
        name,
        description,
        category,
        logo_url,
        is_featured = false,
        is_active = true
    } = req.body;

    if (!name) {
        return res.status(400).json({ message: 'name is required.' });
    }

    try {
        const created = await query(
            `INSERT INTO charities (name, description, category, logo_url, is_featured, is_active)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, name, description, category, logo_url, is_featured, is_active, total_received`,
            [name, description ?? null, category ?? null, logo_url ?? null, !!is_featured, !!is_active]
        );

        return res.status(201).json(created.rows[0]);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Server error.' });
    }
};

export const editCharity = async (req, res) => {
    const { id } = req.params;
    const payload = req.body;

    const allowedFields = [
        'name',
        'description',
        'category',
        'logo_url',
        'is_featured',
        'is_active'
    ];

    const keys = Object.keys(payload).filter((key) => allowedFields.includes(key));
    if (keys.length === 0) {
        return res.status(400).json({ message: 'No valid fields provided to update.' });
    }

    try {
        const existing = await query('SELECT id FROM charities WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ message: 'Charity not found.' });
        }

        const assignments = [];
        const values = [];

        keys.forEach((key, idx) => {
            assignments.push(`${key} = $${idx + 1}`);
            values.push(payload[key]);
        });

        values.push(id);

        const updated = await query(
            `UPDATE charities
             SET ${assignments.join(', ')}
             WHERE id = $${values.length}
             RETURNING id, name, description, category, logo_url, is_featured, is_active, total_received`,
            values
        );

        return res.json(updated.rows[0]);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Server error.' });
    }
};

export const removeCharity = async (req, res) => {
    const { id } = req.params;

    try {
        const deleted = await query('DELETE FROM charities WHERE id = $1 RETURNING id', [id]);

        if (deleted.rows.length === 0) {
            return res.status(404).json({ message: 'Charity not found.' });
        }

        return res.json({ message: 'Charity removed successfully.' });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Server error.' });
    }
};
