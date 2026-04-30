import * as cheerio from 'cheerio';

async function run() {
  const query = "iPhone 15 Pro Max Apple";
  const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
  });
  const text = await response.text();
  const $ = cheerio.load(text);
  const images: string[] = [];
  $('img').each((i, el) => {
    images.push($(el).attr('src') || '');
  });
  console.log(images);
}
run();
