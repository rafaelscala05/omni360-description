import dotenv from "dotenv";
dotenv.config({ override: true });
import { GoogleAuth } from 'google-auth-library';

async function run() {
  try {
    const auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform']
    });
    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();
    
    const projectId = process.env.VERTEX_PROJECT_ID;
    const location = process.env.VERTEX_LOCATION || 'us-central1';
    const model = 'imagen-3.0-capability-001'; 
    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:predict`;
    
    // Create a dummy base64 1x1 image
    const base64Clean = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

    const payload = {
      instances: [
        {
          prompt: "test ambient",
          image: { bytesBase64Encoded: base64Clean },
          context_image: { bytesBase64Encoded: base64Clean }
        }
      ],
      parameters: {
        sampleCount: 1,
        editConfig: {
          editMode: "PRODUCT_IMAGE"
        }
      }
    };

    console.log("Testing with contextImage...");
    const res1 = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    console.log("Status:", res1.status);
    console.log("Body:", await res1.text());

  } catch (error) {
    console.error(error);
  }
}

run();
