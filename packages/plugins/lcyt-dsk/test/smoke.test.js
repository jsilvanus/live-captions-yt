// Guarded smoke test for DSK renderer containerization
if (!process.env.TEST_DSK_CONTAINER) {
  console.log('TEST_DSK_CONTAINER not set — skipping DSK container smoke test');
  process.exit(0);
}

console.log('DSK container smoke test placeholder — build the image and run manual checks');
process.exit(0);
