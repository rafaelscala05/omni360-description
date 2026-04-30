async function run() {
  const query = "iPhone 15 Pro Max Apple";
  const response = await fetch(`https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=isch`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    }
  });
  const text = await response.text();
  console.log(text.substring(0, 500));
}
run();
