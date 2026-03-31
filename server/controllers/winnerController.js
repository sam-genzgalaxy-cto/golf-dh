import { query } from '../services/database.js';
import { sendEmail } from '../services/mailer.js';

export const uploadProof = async (req, res) => {
    const userId = req.user.userId;
    const { match_type, draw_id, proof_url } = req.body;

    if (!match_type || !draw_id) {
        return res.status(400).json({ message: 'match_type and draw_id are required.' });
    }

    if (!['3_match', '4_match', '5_match'].includes(match_type)) {
        return res.status(400).json({ message: "match_type must be one of: '3_match', '4_match', '5_match'." });
    }

    try {
        const existingWinner = await query(
            'SELECT id FROM winners WHERE user_id = $1 AND draw_id = $2',
            [userId, draw_id]
        );

        if (existingWinner.rows.length > 0) {
            return res.status(400).json({ message: 'Winner claim already exists for this draw.' });
        }

        const drawExists = await query('SELECT id FROM draws WHERE id = $1', [draw_id]);
        if (drawExists.rows.length === 0) {
            return res.status(404).json({ message: 'Draw not found.' });
        }

        const prize_estimate = {
            '3_match': 500,
            '4_match': 2000,
            '5_match': 10000
        }[match_type];

        const winner = await query(
            `INSERT INTO winners (draw_id, user_id, match_type, prize_pence, verify_status, proof_url, payout_status)
             VALUES ($1, $2, $3, $4, 'pending', $5, 'pending')
             RETURNING id, draw_id, user_id, match_type, prize_pence, verify_status, proof_url, payout_status`,
            [draw_id, userId, match_type, prize_estimate, proof_url || null]
        );

        try {
            const [userInfo, admins] = await Promise.all([
                query('SELECT full_name, email FROM users WHERE id = $1', [userId]),
                query("SELECT email FROM users WHERE role = 'admin' AND email IS NOT NULL")
            ]);

            const claimant = userInfo.rows[0];
            await Promise.allSettled(
                admins.rows.map((admin) =>
                    sendEmail(
                        admin.email,
                        'Winner Proof Submitted',
                        `A new winner proof has been submitted.\nWinner ID: ${winner.rows[0].id}\nUser: ${claimant?.full_name || userId}\nDraw: ${draw_id}\nMatch type: ${match_type}`,
                        `<p>A new winner proof has been submitted.</p><p><strong>Winner ID:</strong> ${winner.rows[0].id}<br/><strong>User:</strong> ${claimant?.full_name || userId}<br/><strong>Draw:</strong> ${draw_id}<br/><strong>Match type:</strong> ${match_type}</p>`
                    )
                )
            );
        } catch (notifyErr) {
            console.error('Winner proof admin alert email failed:', notifyErr);
        }

        return res.status(201).json({
            message: 'Proof uploaded successfully. Awaiting verification.',
            winner: winner.rows[0]
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Server error.' });
    }
};

export const getMyWinnings = async (req, res) => {
    const userId = req.user.userId;

    try {
        const winnings = await query(
            `SELECT w.id, w.draw_id, w.user_id, w.match_type, w.prize_pence, 
                    w.verify_status, w.payout_status, w.paid_at, d.month
             FROM winners w
             LEFT JOIN draws d ON w.draw_id = d.id
             WHERE w.user_id = $1
             ORDER BY d.month DESC NULLS LAST, w.id DESC`,
            [userId]
        );

        return res.json({
            data: winnings.rows,
            summary: {
                total_winnings_pence: winnings.rows.reduce((sum, w) => sum + (w.prize_pence || 0), 0),
                pending_verification: winnings.rows.filter(w => w.verify_status === 'pending').length,
                approved: winnings.rows.filter(w => w.verify_status === 'approved').length,
                rejected: winnings.rows.filter(w => w.verify_status === 'rejected').length,
                paid: winnings.rows.filter(w => w.payout_status === 'paid').length
            }
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Server error.' });
    }
};



// ADMIN CONTROLLERS



export const listPendingVerifications = async (req, res) => {
    const { page = 1, limit = 10 } = req.query;

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 10));
    const offset = (pageNum - 1) * limitNum;

    try {
        const countResult = await query(
            "SELECT COUNT(*)::int AS total FROM winners WHERE verify_status = 'pending'"
        );

        const dataResult = await query(
            `SELECT w.id, w.draw_id, w.user_id, w.match_type, w.prize_pence, 
                    w.verify_status, w.payout_status, w.proof_url, u.email, u.full_name, d.month
             FROM winners w
             LEFT JOIN users u ON w.user_id = u.id
             LEFT JOIN draws d ON w.draw_id = d.id
             WHERE w.verify_status = 'pending'
             ORDER BY w.id DESC
             LIMIT $1 OFFSET $2`,
            [limitNum, offset]
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

export const verifyWinner = async (req, res) => {
    const { id } = req.params;
    const { status, notes } = req.body;

    if (!status || !['approved', 'rejected'].includes(status)) {
        return res.status(400).json({ message: "status is required and must be 'approved' or 'rejected'." });
    }

    try {
        const winner = await query(
            `SELECT w.id, w.verify_status, w.match_type, w.prize_pence, u.email, u.full_name
             FROM winners w
             JOIN users u ON u.id = w.user_id
             WHERE w.id = $1`,
            [id]
        );

        if (winner.rows.length === 0) {
            return res.status(404).json({ message: 'Winner record not found.' });
        }

        if (winner.rows[0].verify_status !== 'pending') {
            return res.status(400).json({ message: 'Only pending verifications can be updated.' });
        }

        const updated = await query(
            `UPDATE winners 
             SET verify_status = $1 
             WHERE id = $2
             RETURNING id, draw_id, user_id, match_type, prize_pence, verify_status, payout_status`,
            [status, id]
        );

        try {
            const target = winner.rows[0];
            const notesText = notes ? `\n\nAdmin note: ${notes}` : '';
            await sendEmail(
                target.email,
                `Winner Claim ${status === 'approved' ? 'Approved' : 'Rejected'}`,
                `Hi ${target.full_name || 'there'},\n\nYour winner claim has been ${status}.\nMatch type: ${target.match_type}\nPrize (pence): ${target.prize_pence}${notesText}`,
                `<p>Hi ${target.full_name || 'there'},</p><p>Your winner claim has been <strong>${status}</strong>.</p><p><strong>Match type:</strong> ${target.match_type}<br/><strong>Prize (pence):</strong> ${target.prize_pence}</p>${notes ? `<p><strong>Admin note:</strong> ${notes}</p>` : ''}`
            );
        } catch (notifyErr) {
            console.error('Winner verification email notification failed:', notifyErr);
        }

        return res.json({
            message: `Winner ${status === 'approved' ? 'approved' : 'rejected'} successfully.`,
            winner: updated.rows[0]
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Server error.' });
    }
};

export const markAsPaid = async (req, res) => {
    const { id } = req.params;

    try {
        const winner = await query(
            `SELECT w.id, w.payout_status, w.match_type, w.prize_pence, u.email, u.full_name
             FROM winners w
             JOIN users u ON u.id = w.user_id
             WHERE w.id = $1`,
            [id]
        );

        if (winner.rows.length === 0) {
            return res.status(404).json({ message: 'Winner record not found.' });
        }

        if (winner.rows[0].payout_status === 'paid') {
            return res.status(400).json({ message: 'Winner already marked as paid.' });
        }

        const updated = await query(
            `UPDATE winners 
             SET payout_status = 'paid', paid_at = NOW()
             WHERE id = $1
             RETURNING id, draw_id, user_id, match_type, prize_pence, verify_status, payout_status, paid_at`,
            [id]
        );

        try {
            const target = winner.rows[0];
            await sendEmail(
                target.email,
                'Payout Completed',
                `Hi ${target.full_name || 'there'},\n\nYour payout has been completed.\nMatch type: ${target.match_type}\nPaid amount (pence): ${target.prize_pence}`,
                `<p>Hi ${target.full_name || 'there'},</p><p>Your payout has been <strong>completed</strong>.</p><p><strong>Match type:</strong> ${target.match_type}<br/><strong>Paid amount (pence):</strong> ${target.prize_pence}</p>`
            );
        } catch (notifyErr) {
            console.error('Winner payout email notification failed:', notifyErr);
        }

        return res.json({
            message: 'Payout marked as completed.',
            winner: updated.rows[0]
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Server error.' });
    }
};



