// main.js — GTBP Discord Bot
  // Build the project first: pnpm --filter @workspace/api-server run build
  // Then run: node main.js

  import('./artifacts/api-server/dist/index.mjs').catch(console.error);
  