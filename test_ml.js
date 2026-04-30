async function run() {
  const query = "iPhone 15 Pro Max Apple";
  const response = await fetch(`https://api.mercadolibre.com/sites/MLB/search?q=${encodeURIComponent(query)}&limit=4`);
  const data = await response.json();
  console.log(data.results.map(r => r.thumbnail));
}
run();
