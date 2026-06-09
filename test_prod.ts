import dotenv from 'dotenv';
dotenv.config();
import { GoogleAuth } from 'google-auth-library';
import fs from 'fs';

async function run() {
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();
  const accessToken = await client.getAccessToken();
  const projectId = process.env.VERTEX_PROJECT_ID;
  const location = 'us-central1';
  
  // Try PRODUCT_IMAGE feature
  const model = 'imagen-3.0-capability-001';
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:predict`;
  
  // Create a dummy simple base64 image (small transparent PNG)
  const base64Img = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  const payload = {
    instances: [
      {
        prompt: 'A simple red box on a wooden table',
        image: { bytesBase64Encoded: base64Img },
        contextImage: { bytesBase64Encoded: base64Img }
      }
    ],
    parameters: { 
      sampleCount: 1,
      editConfig: {
        editMode: "PRODUCT_IMAGE"
      }
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  console.log(res.status, await res.text());
}
run();

