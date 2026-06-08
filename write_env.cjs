const fs = require('fs');
fs.writeFileSync('.env', `GEMINI_API_KEY="${process.env.GEMINI_API_KEY}"\n`);
console.log("Wrote .env file");
