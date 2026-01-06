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
            required: true
        },
        sum: {
            type: Number,
            required: true
        },
        date: {
            type: Date,
            default: Date.now
        }
    },
    {
        collection: 'Cost'
    }
);

module.exports = mongoose.model('Cost', costSchema);
