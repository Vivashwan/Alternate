import { createApp } from "./app";
import { loadConfig } from "./config";
import { openDatabase } from "./db";

const config = loadConfig();
const db = openDatabase(config.databasePath);
const server = createApp(db, config).listen(config.port, () => {
  console.log(`Alternate backup server listening on :${config.port}`);
});

const shutdown = () => {
  server.close(() => {
    db.close();
    process.exit(0);
  });
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
