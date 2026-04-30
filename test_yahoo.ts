import * as cheerio from 'cheerio';

async function run() {
  const query = "iPhone 15 Pro Max Apple";
  const response = await fetch(`https://images.search.yahoo.com/search/images?p=${encodeURIComponent(query)}`);
  const text = await response.text();
  const $ = cheerio.load(text);
  const images: string[] = [];
  $('img').each((i, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src');
    if (src && src.startsWith('http')) {
      images.push(src);
    }
  });
  console.log(images.slice(0, 5));
}
run();
