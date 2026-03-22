import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { createClient } from "@supabase/supabase-js";
import { config } from "../config";
import { razorpayService } from "../services/RazorpayService";

const supabaseAdmin = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey || config.supabase.anonKey,
);

const router = Router();

router.use((req: Request, res: Response, next: Function) => {
  if (!razorpayService.isConfigured()) {
    res.status(503).json({
      error:
        "Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.",
    });
    return;
  }
  next();
});

async function authenticateRequest(
  req: Request,
  res: Response,
  next: Function,
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing authorization token" });
      return;
    }

    const token = authHeader.split(" ")[1];
    let userId: string;
    let userEmail = "";

    try {
      if (config.supabase.jwtSecret) {
        const decoded = jwt.verify(token, config.supabase.jwtSecret, {
          algorithms: ["HS256"],
        }) as { sub: string; email?: string };
        userId = decoded.sub;
        userEmail = decoded.email || "";
      } else {
        throw new Error("No JWT secret configured");
      }
    } catch {
      const { data, error } = await supabaseAdmin.auth.getUser(token);
      if (error || !data.user) {
        res.status(401).json({ error: "Invalid or expired token" });
        return;
      }
      userId = data.user.id;
      userEmail = data.user.email || "";
    }

    if (!userId) {
      res.status(401).json({ error: "Invalid token" });
      return;
    }

    (req as unknown as { userId: string }).userId = userId;
    (req as unknown as { userEmail: string }).userEmail = userEmail;

    next();
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Auth error";
    console.error("❌ Auth error:", msg);
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

/** POST /api/razorpay/create-subscription — returns { url } for redirect (Razorpay hosted mandate). */
router.post(
  "/create-subscription",
  authenticateRequest,
  async (req: Request, res: Response) => {
    try {
      const userId = (req as unknown as { userId: string }).userId;

      if (!config.razorpay.planId) {
        res.status(500).json({ error: "RAZORPAY_PLAN_ID is not configured" });
        return;
      }

      const { shortUrl } = await razorpayService.createPremiumSubscription(userId);

      res.json({ url: shortUrl });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      console.error("❌ Razorpay create-subscription:", msg);
      res.status(500).json({ error: "Failed to start subscription checkout" });
    }
  },
);

/** POST /api/razorpay/cancel — cancel at end of current billing period */
router.post("/cancel", authenticateRequest, async (req: Request, res: Response) => {
  try {
    const userId = (req as unknown as { userId: string }).userId;
    await razorpayService.cancelSubscriptionAtPeriodEnd(userId);
    res.json({ ok: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("❌ Razorpay cancel:", msg);
    res.status(400).json({ error: msg });
  }
});

/**
 * POST /api/razorpay/verify-subscription-payment
 * Body: { razorpay_payment_id, razorpay_subscription_id, razorpay_signature }
 * (query names after Razorpay redirect). Uses API key secret per integration guide.
 */
router.post(
  "/verify-subscription-payment",
  authenticateRequest,
  async (req: Request, res: Response) => {
    try {
      const userId = (req as unknown as { userId: string }).userId;
      const {
        razorpay_payment_id: paymentId,
        razorpay_subscription_id: subscriptionId,
        razorpay_signature: signature,
      } = req.body || {};

      if (!paymentId || !subscriptionId || !signature) {
        res.status(400).json({
          error:
            "Missing razorpay_payment_id, razorpay_subscription_id, or razorpay_signature",
        });
        return;
      }

      const result = await razorpayService.verifySubscriptionPayment(
        userId,
        String(paymentId),
        String(subscriptionId),
        String(signature),
      );
      res.json(result);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Verification failed";
      console.error("❌ Razorpay verify-subscription-payment:", msg);
      res.status(400).json({ error: msg });
    }
  },
);

/** GET /api/razorpay/status */
router.get("/status", authenticateRequest, async (req: Request, res: Response) => {
  try {
    const userId = (req as unknown as { userId: string }).userId;
    const status = await razorpayService.getSubscriptionStatus(userId);
    res.json(status);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("❌ Razorpay status:", msg);
    res.status(500).json({ error: "Failed to load subscription status" });
  }
});

export default router;

/** Registered in index.ts before express.json() so the body stays raw for HMAC. */
export async function handleRazorpayWebhook(req: Request, res: Response): Promise<void> {
  try {
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body.toString("utf8")
      : typeof req.body === "string"
        ? req.body
        : JSON.stringify(req.body);

    const signature =
      (req.headers["x-razorpay-signature"] as string | undefined) ||
      (req.headers["X-Razorpay-Signature"] as string | undefined);

    if (!razorpayService.verifyWebhookSignature(rawBody, signature)) {
      res.status(400).json({ error: "Invalid webhook signature" });
      return;
    }

    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    await razorpayService.handleWebhookEvent(rawBody, parsed);
    res.json({ ok: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Webhook error";
    console.error("❌ Razorpay webhook:", msg);
    res.status(400).json({ error: msg });
  }
}
