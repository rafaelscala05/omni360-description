async function testServer() {
  try {
    const res = await fetch('http://localhost:3000/api/gemini/generate-description', {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product: { 'Descrição': "Test" },
        template: { prompt: "Test prompt for {nome}" },
        effectiveAttributes: []
      })
    });
    const data = await res.json();
    console.log("Status:", res.status);
    console.log("Data:", data);
  } catch (error) {
    console.error("Fetch Error:", error);
  }
}
testServer();
