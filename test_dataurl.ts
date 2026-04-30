async function run() {
  const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  const res = await fetch(dataUrl);
  console.log(res.status);
  const blob = await res.blob();
  console.log(blob.size);
}
run();
