const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, 'error.log');

function logError(context, err) {
  const timestamp = new Date().toISOString();
  const message = `[${timestamp}] [${context}] ${err.stack || err.message || err}\n`;
  fs.appendFileSync(LOG_FILE, message);
  console.error(message.trim());
}

module.exports = { logError };
