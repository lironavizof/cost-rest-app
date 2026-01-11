require('dotenv').config();
const express = require('express');
const connectDB = require('./config/db');
const logger = require('./middleware/logger');
const costRoutes = require('./routes/costRoutes');


const app = express();

// Middleware
app.use(express.json());
app.use(logger);

// Routes
app.use('/costs/api', costRoutes);

// Health check
app.get('/', (req, res) => {
    res.send('Cost REST API is running');
});

// DB connection
connectDB();

module.exports = app;
