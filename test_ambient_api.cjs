async function testAmbient() {
  const res = await fetch("http://localhost:3000/api/gemini/generate-ambient-images", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      base64Data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      mimeType: "image/png",
      ambientPrompt: "Make it a beautiful sunset"
    })
  });
  
  const data = await res.json();
  console.log("Status:", res.status);
  if (data.image) {
    console.log("Success! Image generated.");
  } else {
    console.log("Response:", data);
  }
}

testAmbient();
