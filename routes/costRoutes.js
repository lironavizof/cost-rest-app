const express = require('express');
const Cost = require('../models/Cost');

const router = express.Router();

/**
 * POST /api/costs
 * Add a new cost item
 */
router.post('/add', async (req, res) => {
    try {
        const cost = new Cost(req.body)

        const savedCost = await cost.save();
        res.status(201).json(savedCost);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

/**
 * GET /api/costs
 * Get all cost items
 */
router.get('/', async (req, res) => {
    try {
        const costs = await Cost.find();
        res.json(costs);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/costs/:userid
 * Get costs by user id
 */
router.get('/:userid', async (req, res) => {
    try {
        const costs = await Cost.find({ userid: req.params.userid });
        res.json(costs);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
