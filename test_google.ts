import * as cheerio from 'cheerio';

async function run() {
  const query = "iPhone 15 Pro Max Apple";
  const response = await fetch(`https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=isch`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
    }
  });
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
