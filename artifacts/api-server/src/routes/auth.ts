import crypto from "node:crypto";
import { Router, type IRouter } from "express";
import { LoginBody, LoginResponse, LogoutResponse, GetAuthStatusResponse } from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { setSessionCookie, clearSessionCookie, isAuthenticated } from "../middlewares/entryAuth";

const router: IRouter = Router();

function passwordMatches(candidate: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    // No password configured → entry stays locked everywhere.
    logger.warn("ADMIN_PASSWORD is not set — data entry is locked until it is configured");
    return false;
  }
  const a = crypto.createHash("sha256").update(candidate).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!passwordMatches(parsed.data.password)) {
    res.status(401).json({ error: "Incorrect password" });
    return;
  }
  setSessionCookie(res);
  res.json(LoginResponse.parse({ authenticated: true }));
});

router.post("/auth/logout", async (_req, res): Promise<void> => {
  clearSessionCookie(res);
  res.json(LogoutResponse.parse({ authenticated: false }));
});

router.get("/auth/me", async (req, res): Promise<void> => {
  res.json(GetAuthStatusResponse.parse({ authenticated: isAuthenticated(req) }));
});

export default router;
