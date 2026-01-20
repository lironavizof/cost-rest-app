const request = require('supertest');


// 1) Mock DB connect
jest.mock('../config/db', () => jest.fn(() => Promise.resolve()));

// 2) Mock logger middleware (so it won't call log-service during tests)
jest.mock('../middleware/logger', () => (req, res, next) => next());

// 3) Mock user service client
jest.mock('../services/user_service_client', () => ({
    userExistsRemote: jest.fn()
}));

// 4) Mock Mongoose models
jest.mock('../models/Cost', () => {
    const Cost = function Cost(data) {
        Object.assign(this, data);

        // mimic mongoose casting
        if (this.date) {
            this.date = new Date(this.date);
        } else {
            this.date = new Date();
        }

        this.save = Cost.__saveMock;
    };

    Cost.__saveMock = jest.fn();
    Cost.find = jest.fn();
    Cost.aggregate = jest.fn();

    return Cost;
});

jest.mock('../models/Report', () => ({
    findOne: jest.fn(),
    // used by saveReport(): new Report({...}).save()
    __saveMock: jest.fn(),
    // constructor mock
    default: null
}));

// Because your code does: const Report = require('../models/Report');
// and then: new Report({...}) -> we need Report to be a function with prototype.save
jest.mock('../models/Report', () => {
    const Report = function Report(data) {
        Object.assign(this, data);
        this.save = Report.__saveMock;
    };
    Report.__saveMock = jest.fn();
    Report.findOne = jest.fn();
    return Report;
});

const Cost = require('../models/Cost');
const Report = require('../models/Report');
const { userExistsRemote } = require('../services/user_service_client');

// import app after mocks
const app = require('../app');

describe('Cost service (unit tests)', () => {

    beforeEach(() => {
        jest.clearAllMocks();
        // make sure NODE_ENV=test in tests to avoid any accidental external calls
        process.env.NODE_ENV = 'test';
    });

    // -------------------------
    // Health check
    // -------------------------
    test('GET / should return health message', async () => {
        const res = await request(app).get('/');
        expect(res.statusCode).toBe(200);
        expect(res.text).toContain('Cost REST API is running');
    });

    // -------------------------
    // GET /costs/api  (list all costs)
    // -------------------------
    test('GET /costs/api should return list of costs', async () => {
        Cost.find.mockResolvedValue([
            { description: 'a', sum: 10 },
            { description: 'b', sum: 20 }
        ]);

        const res = await request(app).get('/costs/api');

        expect(res.statusCode).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBe(2);
        expect(Cost.find).toHaveBeenCalledTimes(1);
    });

    test('GET /costs/api should return 500 on DB error', async () => {
        Cost.find.mockRejectedValue(new Error('DB fail'));

        const res = await request(app).get('/costs/api');

        expect(res.statusCode).toBe(500);
        expect(res.body).toHaveProperty('error');
        expect(res.body.error).toContain('DB fail');
    });

    // -------------------------
    // POST /costs/api/add
    // -------------------------
    test('POST /costs/api/add should add cost (201) when user exists and date is not in past', async () => {
        userExistsRemote.mockResolvedValue(true);

        // Make sure date is in current month so hasMonthPassed(date) === false
        const now = new Date();
        const payload = {
            description: 'choco',
            category: 'food',
            userid: 123,
            sum: 12,
            date: now.toISOString()
        };

        Cost.__saveMock.mockResolvedValue({
            _id: 'abc',
            ...payload,
            date: payload.date
        });

        const res = await request(app).post('/costs/api/add').send(payload);

        expect(res.statusCode).toBe(201);
        expect(userExistsRemote).toHaveBeenCalledWith(123);
        expect(Cost.__saveMock).toHaveBeenCalledTimes(1);
        expect(res.body).toHaveProperty('_id');
    });

    test('POST /costs/api/add should reject when user does not exist (400)', async () => {
        userExistsRemote.mockResolvedValue(false);

        const now = new Date();
        const payload = {
            description: 'x',
            category: 'food',
            userid: 999,
            sum: 1,
            date: now.toISOString()
        };

        const res = await request(app).post('/costs/api/add').send(payload);

        expect(res.statusCode).toBe(400);
        expect(res.body.error).toContain('User does not exist');
        expect(Cost.__saveMock).not.toHaveBeenCalled();
    });

    test('POST /costs/api/add should reject when month passed (400)', async () => {
        userExistsRemote.mockResolvedValue(true);

        // date clearly in the past (month passed)
        const past = new Date(2000, 0, 1);

        const payload = {
            description: 'old',
            category: 'food',
            userid: 123,
            sum: 5,
            date: past.toISOString()
        };

        const res = await request(app).post('/costs/api/add').send(payload);

        expect(res.statusCode).toBe(400);
        expect(res.body.error).toContain('month passed');
        expect(Cost.__saveMock).not.toHaveBeenCalled();
    });

    test('POST /costs/api/add should return 400 on validation/DB error', async () => {
        userExistsRemote.mockResolvedValue(true);

        const now = new Date();
        const payload = {
            description: 'x',
            category: 'food',
            userid: 123,
            sum: 1,
            date: now.toISOString()
        };

        Cost.__saveMock.mockRejectedValue(new Error('save failed'));

        const res = await request(app).post('/costs/api/add').send(payload);

        expect(res.statusCode).toBe(400);
        expect(res.body.error).toContain('save failed');
    });

    // -------------------------
    // GET /costs/api/total/:userid
    // -------------------------
    test('GET /costs/api/total/:userid should return total (200)', async () => {
        Cost.aggregate.mockResolvedValue([{ _id: 123, total: 42 }]);

        const res = await request(app).get('/costs/api/total/123');

        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ userid: 123, total: 42 });
        expect(Cost.aggregate).toHaveBeenCalledTimes(1);
    });

    test('GET /costs/api/total/:userid should return 0 when no costs', async () => {
        Cost.aggregate.mockResolvedValue([]);

        const res = await request(app).get('/costs/api/total/123');

        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ userid: 123, total: 0 });
    });

    test('GET /costs/api/total/:userid should reject invalid userid (400)', async () => {
        const res = await request(app).get('/costs/api/total/abc');

        expect(res.statusCode).toBe(400);
        expect(res.body.error).toContain('userid must be a positive number');
    });

    test('GET /costs/api/total/:userid should return 500 on aggregation error', async () => {
        Cost.aggregate.mockRejectedValue(new Error('agg fail'));

        const res = await request(app).get('/costs/api/total/123');

        expect(res.statusCode).toBe(500);
        expect(res.body.error).toContain('agg fail');
    });

    // -------------------------
    // GET /costs/api/report?userid=&year=&month=
    // -------------------------
    test('GET /costs/api/report should return 400 when missing params', async () => {
        const res = await request(app).get('/costs/api/report?userid=1&year=2026');

        expect(res.statusCode).toBe(400);
        expect(res.body.error).toContain('Missing required query parameters');
    });

    test('GET /costs/api/report should return 400 when params not numbers', async () => {
        const res = await request(app).get('/costs/api/report?userid=abc&year=2026&month=1');

        expect(res.statusCode).toBe(400);
        expect(res.body.error).toContain('userid, year and month must be numbers');
    });

    test('GET /costs/api/report should return 400 when month out of range', async () => {
        const res = await request(app).get('/costs/api/report?userid=1&year=2026&month=13');

        expect(res.statusCode).toBe(400);
        expect(res.body.error).toContain('month must be between 1 and 12');
    });

    test('GET /costs/api/report should return 400 when user does not exist', async () => {
        userExistsRemote.mockResolvedValue(false);

        const res = await request(app).get('/costs/api/report?userid=1&year=2026&month=1');

        expect(res.statusCode).toBe(400);
        expect(res.body.error).toContain('User does not exist');
    });

    test('GET /costs/api/report (current/future month) should build report from Cost.aggregate', async () => {
        userExistsRemote.mockResolvedValue(true);

        // Choose current month so now <= endOfRequestedMonth
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;

        // Return categories from DB: food + milk (dynamic)
        Cost.aggregate.mockResolvedValue([
            { _id: 'milk', items: [{ sum: 5, description: 'a', day: 1 }] },
            { _id: 'food', items: [{ sum: 10, description: 'b', day: 2 }] }
        ]);

        const res = await request(app).get(`/costs/api/report?userid=123&year=${year}&month=${month}`);

        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty('finalResponse');

        const report = res.body.finalResponse;
        expect(report.userid).toBe(123);
        expect(report.year).toBe(year);
        expect(report.month).toBe(month);

        // Must include fixed categories even if empty
        const categories = report.costs.map(obj => Object.keys(obj)[0]);
        expect(categories).toEqual(expect.arrayContaining(['food', 'education', 'health', 'housing']));
        expect(categories).toEqual(expect.arrayContaining(['milk'])); // dynamic category

        expect(Cost.aggregate).toHaveBeenCalledTimes(1);
        expect(Report.findOne).not.toHaveBeenCalled();
        expect(Report.__saveMock).not.toHaveBeenCalled();
    });

    test('GET /costs/api/report (past month) should return cached report if exists', async () => {
        userExistsRemote.mockResolvedValue(true);

        Report.findOne.mockReturnValue({
            lean: jest.fn().mockResolvedValue({
                userid: 123,
                year: 2000,
                month: 1,
                costs: [{ food: [] }]
            })
        });

        const res = await request(app).get('/costs/api/report?userid=123&year=2000&month=1');

        expect(res.statusCode).toBe(200);
        expect(res.body.finalResponse).toHaveProperty('userid', 123);

        expect(Report.findOne).toHaveBeenCalledTimes(1);
        expect(Cost.aggregate).not.toHaveBeenCalled();
        expect(Report.__saveMock).not.toHaveBeenCalled();
    });

    test('GET /costs/api/report (past month) should build & save report if not cached', async () => {
        userExistsRemote.mockResolvedValue(true);

        Report.findOne.mockReturnValue({
            lean: jest.fn().mockResolvedValue(null)
        });

        Cost.aggregate.mockResolvedValue([
            { _id: 'food', items: [{ sum: 1, description: 'x', day: 1 }] }
        ]);

        Report.__saveMock.mockResolvedValue({ ok: true });

        const res = await request(app).get('/costs/api/report?userid=123&year=2000&month=1');

        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty('finalResponse');

        expect(Cost.aggregate).toHaveBeenCalledTimes(1);
        expect(Report.findOne).toHaveBeenCalledTimes(1);
        expect(Report.__saveMock).toHaveBeenCalledTimes(1);
    });

});
