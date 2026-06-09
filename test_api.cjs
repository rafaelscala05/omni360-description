async function run() {
  const base64Data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const { GoogleAuth } = await import('google-auth-library');
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();
  const accessToken = await client.getAccessToken();
  const projectId = process.env.VERTEX_PROJECT_ID;
  
  const payload = {
    instances: [{
      prompt: "A beautiful sunset",
      image: { bytesBase64Encoded: base64Data },
      context_image: { bytesBase64Encoded: base64Data }
    }],
    parameters: {
      sampleCount: 1,
      editConfig: { editMode: "PRODUCT_IMAGE" }
    }
  };

  const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/imagen-3.0-capability-001:predict`;
  
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken.token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  console.log(res.status, await res.text());
}
run();
