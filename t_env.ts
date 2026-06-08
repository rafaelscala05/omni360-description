async function p() {
  const r = await fetch('http://localhost:3000/api/env');
  console.log(await r.json());
}
p();
