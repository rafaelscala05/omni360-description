const express = require('express');
const app = express();
app.use(express.json({ limit: '50mb' }));

app.post('/test', async (req, res) => {
  const base64Data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const mimeType = "image/png";
  const ambientPrompt = "A beautiful sunset";
  
  const { GoogleAuth } = await import('google-auth-library');
  const auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform']
  });
  const client = await auth.getClient();
  const accessToken = await client.getAccessToken();
  
  const projectId = process.env.VERTEX_PROJECT_ID;
  const location = 'us-central1';
  const model = 'imagen-3.0-capability-001';
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:predict`;
  
  const vertexResponse = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken.token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      instances: [
        {
          prompt: ambientPrompt,
          image: { bytesBase64Encoded: base64Data },
          context_image: { bytesBase64Encoded: base64Data }
        }
      ],
      parameters: {
        sampleCount: 1,
        editConfig: { editMode: "PRODUCT_IMAGE" }
      }
    })
  });

  const text = await vertexResponse.text();
  res.send(text);
});

app.listen(3001, () => {
  console.log('Listening 3001');
});
