async function run() {
  const query = "iPhone 15 Pro Max Apple";
  const response = await fetch(`https://lite.duckduckgo.com/lite/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    },
    body: `q=${encodeURIComponent(query)}`
  });
  const text = await response.text();
  console.log(text.match(/<img[^>]+src="([^">]+)"/g)?.slice(0, 5));
}
run();
