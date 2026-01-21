const express = require('express');
const Cost = require('../models/Cost');
const Report = require('../models/Report');

const {userExistsRemote} = require("../services/user_service_client");

const router = express.Router();

/* add new cost
 * input: req.body { description, category, userid, sum, date? }
 * output: 201 saved cost OR 400/500 error
 * POST costs/api */
router.post('/add', async (req, res) => {

    //add-log ("user send add")
    try {
        const cost = new Cost(req.body)
        if(hasMonthPassed(cost.date)){
            res.locals.error = { id: 400, message:  'month passed' };
            return res.status(400).json({ error: res.locals.error.message });
        }

        const exists = await userExistsRemote(Number(cost.userid));
        if (!exists) {
            res.locals.error = { id: 400, message:  'User does not exist' };
            return res.status(400).json({ error: res.locals.error.message });
        }
        const savedCost = await cost.save();
        res.status(201).json(savedCost);
    } catch (err) {
        res.locals.error = { id: 400, message:   err.message };
        res.status(400).json({ error: res.locals.error.message });
        //
    }
});
/* checks if the month of the date already ended */
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


/* get all costs
 * output: array of costs
 * GET /costs/api */
router.get('', async (req, res) => {
    try {
        const costs = await Cost.find();
        res.json(costs);
    } catch (err) {
        res.locals.error = { id: 500, message:   err.message };
        res.status(500).json({ error: err.message });
    }
});


/* GET /api/costs/total/:userid
 * Returns: { userid: <number>, total: <number> } */
router.get('/total/:userid', async (req, res) => {
    try {
        const userIdNum = Number(req.params.userid);

        if (Number.isNaN(userIdNum) || userIdNum <= 0) {
            res.locals.error = { id: 400, message:   'userid must be a positive number' };
            return res.status(400).json({ error:  res.locals.error.message });
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
        res.locals.error = { id: 500, message:   err.message };
        return res.status(500).json({ error: res.locals.error.message });
    }
});

/* monthly report
 * query: userid, year, month
 * current/future month -> build from costs
 * past month -> try cached report, else build and save
 * GET /api/report?userid=111&year=2026&month=1 */
router.get('/report', async (req, res) => {
    try {
        const { userid: id, year, month } = req.query;

        if (!id || !year || !month) {
            return res.status(400).json({
                error: 'Missing required query parameters: id, year, month'
            });
        }

        const userIdNum = Number(id);
        const yearNum = Number(year);
        const monthNum = Number(month);


        if (isNaN(userIdNum) || isNaN(yearNum) || isNaN(monthNum)) {
            res.locals.error = { id: 400, message:   'id, year and month must be numbers'};
            return res.status(400).json({
                error: res.locals.error.message
            });
        }

        if (monthNum < 1 || monthNum > 12) {
            res.locals.error = { id: 400, message:   'month must be between 1 and 12'};
            return res.status(400).json({
                error: res.locals.error.message
            });
        }
        const exists = await userExistsRemote(Number(userIdNum));
        if (!exists) {
            res.locals.error = { id: 400, message:   'User does not exist'};
            return res.status(400).json({ error: res.locals.error.message });
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
            // if it exists, return
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
        res.locals.error = { id: 500, message:   err.message};
        res.status(500).json({ error: res.locals.error.message });
    }
});



/* services/reportFromCosts.js
 * We check if a monthly report for the user already exists in the Reports collection.
 * If it's missing, we calculate it from the Costs collection, save it to the DB
 * for future requests, and return it. This saves database resources. */

const FIXED_CATEGORIES = ['food', 'education', 'health', 'housing'];

/* This function builds the report JSON by aggregating costs from the database */
const getReportFromCostCollection = async (
    userIdNum,
    monthNum,
    yearNum,
    startDate,
    endDate
) => {

    // Using MongoDB aggregation to find all costs for a specific user and month
    const aggregationResult = await Cost.aggregate([
        {
            $match: {
                userid: userIdNum,
                date: { $gte: startDate, $lt: endDate }
            }
        },
        /* Sorting the results by category and date for order */
        { $sort: { category: 1, date: 1, _id: 1 } },
        /* Grouping items by their category as required in the project document */
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

    /* Creating a map to easily access items by their category name */
    const categoryMap = {};
    aggregationResult.forEach(g => {
        categoryMap[g._id] = g.items;
    });

    /* Getting all categories that actually appeared in the DB */
    const dynamicCategories = Object.keys(categoryMap);

    /* Merging required categories with dynamic ones and removing duplicates */
    const merged = [
        ...FIXED_CATEGORIES,
        ...dynamicCategories.filter(c => !FIXED_CATEGORIES.includes(c))
    ];
    /* Sorting extra categories alphabetically */
    const extraSorted = merged
        .slice(FIXED_CATEGORIES.length)
        .sort((a, b) => a.localeCompare(b));

    const finalCategories = [...FIXED_CATEGORIES, ...extraSorted];

    /* Mapping the categories into the final JSON structure requested by the lecturer */
    const costsArray = finalCategories.map(category => ({
        [category]: categoryMap[category] || []
    }));

    /* Returning the final report object */
    return {
        userid: userIdNum,
        year: yearNum,
        month: monthNum,
        costs: costsArray
    };
};





/* Saving the pre-calculated report to MongoDB for the Computed Pattern */
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
    /* Saving the new report document to the reports collection */
    return await report.save();
}
/* Searching for an existing report to avoid calculating it again */
async function findReportByUserAndMonth(userid, year, month) {
    /* Using lean() for faster read-only access to the report data */
    return await Report.findOne({
        userid,
        year,
        month
    }).lean();
}
module.exports = router;
