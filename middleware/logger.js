const pinoHttp = require('pino-http');

const logger = pinoHttp({
    level: 'info'
});

module.exports = logger;
