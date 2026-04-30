async function run() {
  const query = "mala de viagem";
  const res = await fetch(`https://pt.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrnamespace=6&gsrlimit=4&prop=imageinfo&iiprop=url&format=json&origin=*`);
  const data = await res.json();
  const pages = data.query?.pages;
  const urls = pages ? Object.values(pages).map((p: any) => p.imageinfo[0].url) : [];
  console.log(urls);
}
run();
