async function run() {
  const query = "iPhone 15 Pro Max Apple";
  const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    }
  });
  const text = await response.text();
  console.log(text.match(/<img[^>]+src="([^">]+)"/g)?.slice(0, 5));
}
run();
