const express = require('express');
const Cost = require('../models/Cost');
const {userExistsRemote} = require("../services/userServiceClient");

const router = express.Router();

/**
 * POST costs/api
 * Add a new cost item
 */
router.post('/add', async (req, res) => {
    try {
        const cost = new Cost(req.body)

        const exists = await userExistsRemote(Number(cost.userid));
        if (!exists) {
            return res.status(400).json({ error: 'User does not exist' });
        }
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
router.get('', async (req, res) => {
    try {
        const costs = await Cost.find();
        res.json(costs);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
//  * GET /api/costs/:userid
//  * Get costs by user id
//  */
// router.get('/:userid', async (req, res) => {
//     try {
//         const costs = await Cost.find({ userid: req.params.userid });
//         res.json(costs);
//     } catch (err) {
//         res.status(500).json({ error: err.message });
//     }
// });

// GET /api/report?userid=111&year=2026&month=1
router.get('/report', async (req, res) => {
    try {
        const { userid, year, month } = req.query;

        if (!userid || !year || !month) {
            return res.status(400).json({
                error: 'Missing required query parameters: userid, year, month'
            });
        }

        const userIdNum = Number(userid);
        const yearNum = Number(year);
        const monthNum = Number(month);

        if (isNaN(userIdNum) || isNaN(yearNum) || isNaN(monthNum)) {
            return res.status(400).json({
                error: 'userid, year and month must be numbers'
            });
        }

        if (monthNum < 1 || monthNum > 12) {
            return res.status(400).json({
                error: 'month must be between 1 and 12'
            });
        }

        const startDate = new Date(yearNum, monthNum - 1, 1);
        const endDate = new Date(yearNum, monthNum, 1);

        // Aggregate costs grouped by category
        const aggregationResult = await Cost.aggregate([
            {
                $match: {
                    userid: userIdNum,
                    date: { $gte: startDate, $lt: endDate }
                }
            },
            {
                $group: {
                    _id: '$category',
                    costs: {
                        $push: {
                            sum: '$sum',
                            description: '$description',
                            day: { $dayOfMonth: '$date' }
                        }
                    }
                }
            }
        ]);

        // Build the costs array as requested
        // Each element is { categoryName: [costs...] }
        const costsArray = aggregationResult.map(item => {
            return { [item._id]: item.costs };
        });

        // Final response
        const response = {
            userid: userIdNum,
            year: yearNum,
            month: monthNum,
            costs: costsArray
        };

        res.json(response);

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// GET /api/costs/total/:userid
// Returns: { userid: <number>, total: <number> }
router.get('/total/:userid', async (req, res) => {
    try {
        const userIdNum = Number(req.params.userid);

        if (Number.isNaN(userIdNum) || userIdNum <= 0) {
            return res.status(400).json({ error: 'userid must be a positive number' });
        }

        const agg = await Cost.aggregate([
            { $match: { userid: userIdNum } },
            { $group: { _id: '$userid', total: { $sum: '$sum' } } }
        ]);

        const total = agg.length > 0 ? agg[0].total : 0;

        return res.json({
            userid: userIdNum,
            total
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});






module.exports = router;
