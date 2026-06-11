const dotenv = require("dotenv");
dotenv.config({ override: true });
const { GoogleAuth } = require('google-auth-library');

async function run() {
  const projectId = process.env.VERTEX_PROJECT_ID;
  if (!projectId) {
    console.log("VERTEX_PROJECT_ID is NOT set. The app will fallback to Gemini.");
    return;
  }
  let location = process.env.VERTEX_LOCATION || 'us-central1';
  if (location === 'global') location = 'us-central1';

  console.log("Vertex configured with project:", projectId, "location:", location);

  const auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform']
  });
  const client = await auth.getClient();
  const accessToken = await client.getAccessToken();

  const model = 'imagegeneration@006';
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:predict`;

  // Create a 1x1 white pixel base64 image
  const base64Clean = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";

  const ambientPrompt = "A nice ambient background.";

  const body = JSON.stringify({
    instances: [
      {
        prompt: ambientPrompt,
        referenceImage: {
          bytesBase64Encoded: base64Clean 
        }
      }
    ],
    parameters: {
      sampleCount: 1,
      editConfig: {
        editMode: "PRODUCT_IMAGE"
      }
    }
  });

  const vertexResponse = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken.token}`,
      'Content-Type': 'application/json'
    },
    body
  });

  if (!vertexResponse.ok) {
     const err = await vertexResponse.text();
     console.error("Vertex API ERROR:", err);
  } else {
     console.log("Success with referenceImage");
  }

  // Also try with 'image' to see if that was the problem
  const body2 = JSON.stringify({
    instances: [
      {
        prompt: ambientPrompt,
        image: {
          bytesBase64Encoded: base64Clean 
        }
      }
    ],
    parameters: {
      sampleCount: 1,
      editConfig: {
        editMode: "PRODUCT_IMAGE"
      }
    }
  });
  const vertexResponse2 = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken.token}`,
        'Content-Type': 'application/json'
      },
      body: body2
    });
  
    if (!vertexResponse2.ok) {
       const err = await vertexResponse2.text();
       console.error("Vertex API ERROR with 'image':", err);
    } else {
       console.log("Success with 'image'");
    }
}
run();
