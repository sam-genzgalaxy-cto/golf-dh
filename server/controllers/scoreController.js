export const getScores= async (req, res) => {
    const userId = req.user.userId;
    try {
        const scores = await query('SELECT score, played_at FROM scores WHERE user_id = $1 ORDER BY played_at DESC', [userId]);
        res.json(scores.rows);
    }catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error." });
    }
};

export const addScore = async (req, res) => {
    const userId = req.user.userId;
    const { score } = req.body;
    if(score === undefined){
        return res.status(400).json({ message: "Score is required." });
    }
     if(score<1 || score > 45){
        return res.status(400).json({ message: "Score must be between 1 and 45." });
    }
    
    const existing = await query('SELECT id FROM scores WHERE user_id = $1 ORDER BY played_at ASC', [userId]);
    if(existing.rows.length >= 5){
        await query('DELETE FROM scores WHERE id = $1', [existing.rows[0].id]);
    }
    try {
        await query('INSERT INTO scores (user_id, score) VALUES ($1, $2)', [userId, score]);
        res.status(201).json({ message: "Score added successfully." });
    }catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error." });
    }
};

export const updateScore = async (req, res) => {
    const userId = req.user.userId;
    const { scoreId } = req.params;
    const { score } = req.body;
    if(score === undefined){
        return res.status(400).json({ message: "Score is required." });
    }
     if(score<1 || score > 45){
        return res.status(400).json({ message: "Score must be between 1 and 45." });
    }
    try {
        const existing = await query('SELECT id FROM scores WHERE id = $1 AND user_id = $2', [scoreId, userId]);
        if(existing.rows.length === 0){
            return res.status(404).json({ message: "Score not found." });
        }
        await query('UPDATE scores SET score = $1, played_at = NOW() WHERE id = $2', [score, scoreId]);
        res.json({ message: "Score updated successfully." });
    }catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error." });
    }
};

export const deleteScore = async (req, res) => {
    const userId = req.user.userId;
    const { scoreId } = req.params;
    try {
        const existing = await query('SELECT id FROM scores WHERE id = $1 AND user_id = $2', [scoreId, userId]);
        if(existing.rows.length === 0){
            return res.status(404).json({ message: "Score not found." });
        }
        await query('DELETE FROM scores WHERE id = $1', [scoreId]);
        res.json({ message: "Score deleted successfully." });
    }catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error." });
    }
};


// ADMIN CONTROLLERS

export const editscorebyadmin = async (req, res) => {
    const { scoreId } = req.params;
    const { score } = req.body;
    if(score === undefined){
        return res.status(400).json({ message: "Score is required." });
    }
    if(score<1 || score > 45){
        return res.status(400).json({ message: "Score must be between 1 and 45." });
    }
    try {
        const existing = await query('SELECT id FROM scores WHERE id = $1', [scoreId ]);
        if(existing.rows.length === 0){
            return res.status(404).json({ message: "Score not found." });
        }
        await query('UPDATE scores SET score = $1, played_at = NOW() WHERE id = $2', [score, scoreId]);
        res.json({ message: "Score updated successfully." });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error." });
    }
};
