async function run() {
  try {
    const res = await fetch('https://upload.wikimedia.org/wikipedia/commons/1/14/Compare_iPhone_16_Pro_with_the_iPhone_15_Pro.jpg');
    console.log(res.status);
  } catch (e) {
    console.error(e);
  }
}
run();
