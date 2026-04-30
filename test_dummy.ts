async function run() {
  const query = "shirt";
  const res = await fetch(`https://dummyjson.com/products/search?q=${encodeURIComponent(query)}`);
  const data = await res.json();
  console.log(data.products.map((p: any) => p.images[0]));
}
run();
