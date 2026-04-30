async function run() {
  const url = 'https://upload.wikimedia.org/wikipedia/commons/1/14/Compare_iPhone_16_Pro_with_the_iPhone_15_Pro.jpg';
  const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
  const res = await fetch(proxyUrl);
  console.log(res.status);
}
run();
