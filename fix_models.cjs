const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

code = code.replace(/gemini-3\.5-flash/g, 'gemini-2.5-flash');
code = code.replace(/gemini-3\.1-flash-lite/g, 'gemini-2.5-flash');
code = code.replace(/: 'gemini-3\.5'/g, ": 'gemini-2.5-flash'");

// Replace the payload for Vertex
const oldInstances = `            instances: [
              {
                prompt: ambientPrompt,
                image: {
                  bytesBase64Encoded: base64Clean 
                },
                baseImage: {
                  bytesBase64Encoded: base64Clean
                },
                referenceImages: [{
                  referenceImage: { bytesBase64Encoded: base64Clean },
                  referenceType: "PRODUCT_IMAGE"
                }]
              }
            ],`;

const newInstances = `            instances: [
              {
                prompt: ambientPrompt,
                image: {
                  bytesBase64Encoded: base64Clean 
                },
                context_image: {
                  bytesBase64Encoded: base64Clean
                }
              }
            ],`;

code = code.replace(oldInstances, newInstances);
fs.writeFileSync('server.ts', code);
console.log('Fixed server.ts');
