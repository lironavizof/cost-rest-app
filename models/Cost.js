const mongoose = require('mongoose');

const costSchema = new mongoose.Schema(
    {
        description: {
            type: String,
            required: true,
            trim: true
        },
        category: {
            type: String,
            required: true
        },
        userid: {
            type: Number,
            required: true,
            min: 1
        },
        sum: {
            type: Number,
            required: true,
            min: [Number.MIN_VALUE, 'sum must be a positive number']

        },
        date: {
            type: Date,
            default: Date.now
        }
    },
    {
        collection: 'costs'
    }
);

module.exports = mongoose.model('Cost', costSchema);
