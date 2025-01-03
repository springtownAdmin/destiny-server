const winston = require('winston');
const path = require('path');

// const logger = winston.createLogger({
//     level: 'info',
//     format: winston.format.combine(
//         winston.format.timestamp(),
//         winston.format.json()
//     ),
//     transports: [
//         new winston.transports.File({ filename: path.join(__dirname, 'logs', 'application.log') }),
//         new winston.transports.Console()
//     ],
// });

const logger = () => {
    console.log("from logger");
    
}

// const siteLogger = winston.createLogger({
//     level: 'info',
//     format: winston.format.combine(
//         winston.format.timestamp(),
//         winston.format.json()
//     ),
//     transports: [
//         new winston.transports.File({ filename: '/var/www/destiny-product-site/logs/application.log' }),
//         new winston.transports.Console()
//     ],
// });

const siteLogger = () => {
    console.log("from siteLogger");
    
}

module.exports = { logger, siteLogger };
