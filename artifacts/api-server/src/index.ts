import app from "./app";
import { logger } from "./lib/logger";
import { startBot } from "./bot";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Ping own health endpoint every 4 minutes to prevent Replit from sleeping
  const FOUR_MINUTES = 4 * 60 * 1000;
  setInterval(() => {
    fetch(`http://localhost:${port}/api/healthz`)
      .then(() => logger.info("Self-ping: keep-alive ok"))
      .catch((err) => logger.warn({ err }, "Self-ping failed"));
  }, FOUR_MINUTES);
});

try {
  console.log("[index] Calling startBot()...");
  startBot();
  console.log("[index] startBot() returned");
} catch (err) {
  console.error("[index] startBot() threw:", err);
}
