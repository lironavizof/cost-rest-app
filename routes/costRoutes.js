const express = require('express');
const Cost = require('../models/Cost');
const Report = require('../models/Report');

const {userExistsRemote} = require("../services/userServiceClient");

const router = express.Router();

/**
 * POST costs/api
 * Add a new cost item
 */
router.post('/add', async (req, res) => {

    //add-log ("user send add")
    try {
        const cost = new Cost(req.body)
        if(hasMonthPassed(cost.date)){
            return res.status(400).json({ error: 'month passed' });
        }

        const exists = await userExistsRemote(Number(cost.userid));
        if (!exists) {
            return res.status(400).json({ error: 'User does not exist' });
        }
        const savedCost = await cost.save();
        res.status(201).json(savedCost);
    } catch (err) {
        res.status(400).json({ error: err.message });
        //
    }
});

function hasMonthPassed(date) {
    const now = new Date();

    // last day of the month of the given date
    const endOfMonth = new Date(
        date.getFullYear(),
        date.getMonth() + 1,
        0
    );

    return now > endOfMonth;
}



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
        const exists = await userExistsRemote(Number(userIdNum));
        if (!exists) {
            return res.status(400).json({ error: 'User does not exist' });
        }

        const endOfRequestedMonth = new Date(yearNum, monthNum, 0);

        const now = new Date();
        const startDate = new Date(yearNum, monthNum - 1, 1);
        const endDate = new Date(yearNum, monthNum, 1);
        let finalResponse = {};
        if (now <= endOfRequestedMonth) {
            // get new report
            finalResponse =  await getReportFromCostCollection(userIdNum,monthNum, yearNum, startDate, endDate);
        }
        else{
            //check if exist in REPORT collection
            // if it exist, return
            const report = await findReportByUserAndMonth(userIdNum, yearNum, monthNum);
            if (report!= null)
                finalResponse = report;

            // else - get new report and save it in report collection
            else
            {
                const newReport = await getReportFromCostCollection(userIdNum, monthNum, yearNum,startDate, endDate);
                const savedReport = await saveReport(newReport);
                finalResponse = newReport;
            }
        }

        return res.status(200).json({finalResponse});



    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});



// services/reportFromCosts.js

const FIXED_CATEGORIES = ['food', 'education', 'health', 'housing'];

/**
 * Build monthly report JSON from the Cost collection.
 * Returns:
 * - always the FIXED_CATEGORIES (even if empty)
 * - plus any dynamic categories found in DB for that month
 *
 * Output format:
 * {
 *   userid, year, month,
 *   costs: [ { food: [...] }, { education: [...] }, ... , { milk: [...] } ]
 * }
 */
const getReportFromCostCollection = async (
    userIdNum,
    monthNum,
    yearNum,
    startDate,
    endDate
) => {
    const aggregationResult = await Cost.aggregate([
        {
            $match: {
                userid: userIdNum,
                date: { $gte: startDate, $lt: endDate }
            }
        },
        { $sort: { category: 1, date: 1, _id: 1 } },
        {
            $group: {
                _id: '$category',
                items: {
                    $push: {
                        sum: '$sum',
                        description: '$description',
                        day: { $dayOfMonth: '$date' }
                    }
                }
            }
        }
    ]);

    // Build map: category -> items[]
    const categoryMap = {};
    aggregationResult.forEach(g => {
        categoryMap[g._id] = g.items;
    });

    // Dynamic categories from DB
    const dynamicCategories = Object.keys(categoryMap);

    // Merge fixed + dynamic, remove duplicates, keep stable order:
    // - fixed categories first (in that exact order)
    // - then other categories (sorted alphabetically)
    const merged = [
        ...FIXED_CATEGORIES,
        ...dynamicCategories.filter(c => !FIXED_CATEGORIES.includes(c))
    ];

    const extraSorted = merged
        .slice(FIXED_CATEGORIES.length)
        .sort((a, b) => a.localeCompare(b));

    const finalCategories = [...FIXED_CATEGORIES, ...extraSorted];

    // Build costs array with all categories
    const costsArray = finalCategories.map(category => ({
        [category]: categoryMap[category] || []
    }));

    return {
        userid: userIdNum,
        year: yearNum,
        month: monthNum,
        costs: costsArray
    };
};






async function saveReport(reportData) {
    const {
        userid,
        year,
        month,
        costs
    } = reportData;

    const report = new Report({
        userid,
        year,
        month,
        costs
    });

    return await report.save();
}

async function findReportByUserAndMonth(userid, year, month) {
    return await Report.findOne({
        userid,
        year,
        month
    }).lean();
}
module.exports = router;
