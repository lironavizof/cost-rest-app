const mongoose = require('mongoose');

const CostItemSchema = new mongoose.Schema(
    {
        sum: { type: Number, required: true },
        description: { type: String, required: true },
        day: { type: Number, required: true }
    },
    { _id: false }
);

const CategorySchema = new mongoose.Schema(
    {},
    { strict: false, _id: false }
);

const ReportSchema = new mongoose.Schema({
    userid: {
        type: Number,
        required: true
    },
    year: {
        type: Number,
        required: true
    },
    month: {
        type: Number,
        required: true
    },
    costs: {
        type: [CategorySchema],
        required: true
    }
});

module.exports = mongoose.model('Report', ReportSchema);
