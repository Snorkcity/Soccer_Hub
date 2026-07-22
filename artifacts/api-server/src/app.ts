import path from "node:path";
import fs from "node:fs";
import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { requireSession } from "./middlewares/entryAuth";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
// Only the screenshot-reader endpoint accepts large bodies (base64 image);
// everything else keeps a tight default limit.
app.use("/api/entry/extract-players", express.json({ limit: "25mb" }));
// Voice interview turns carry base64 audio recordings.
app.use("/api/journal/interview", express.json({ limit: "25mb" }));
app.use("/api/library/practices/upload", express.json({ limit: "25mb" }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// Whole API requires a session (any role reads; only admin writes)
app.use("/api", requireSession);
app.use("/api", router);

// In production (e.g. hosting on Railway as a single combined service), the
// API server also serves the built frontend. On Replit's dev + Deployments the
// frontend is served separately by the platform router, so this only kicks in
// when NODE_ENV=production and a built client bundle is present.
if (process.env.NODE_ENV === "production") {
  const clientDir = process.env.CLIENT_DIST_DIR
    ? path.resolve(process.env.CLIENT_DIST_DIR)
    : path.resolve(process.cwd(), "artifacts/bufc-hub/dist/public");
  const indexHtml = path.join(clientDir, "index.html");

  if (fs.existsSync(indexHtml)) {
    logger.info({ clientDir }, "Serving frontend static bundle");
    app.use(express.static(clientDir));

    // SPA fallback: serve index.html for client-side navigation routes
    // (e.g. /season-stats) so deep links resolve. Requests that look like a
    // file (anything with an extension, e.g. a missing JS/CSS bundle) fall
    // through to a real 404 instead of being masked by index.html.
    app.use((req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      if (req.path.startsWith("/api")) return next();
      if (path.extname(req.path)) return next();
      res.sendFile(indexHtml);
    });
  } else {
    logger.warn(
      { clientDir },
      "Frontend bundle not found; serving API only. Did the client build run?",
    );
  }
}

export default app;
