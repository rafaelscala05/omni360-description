import fs from "fs";
const serverTs = fs.readFileSync('server.ts', 'utf8');
console.log("Does server.ts have GEMINI_API_KEY hardcoded?", serverTs.includes('GEMINI_API_KEY'));
