import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { createClient } from "@supabase/supabase-js";
import { config } from "../config";
import { stripeService } from "../services/StripeService";

const supabaseAdmin = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey || config.supabase.anonKey
);

const router = Router();

/**
 * Guard middleware - return 503 if Stripe is not configured
 */
router.use((req: Request, res: Response, next: Function) => {
  // Allow webhook even if unconfigured (it'll fail at signature check anyway)
  if (!stripeService.isConfigured() && req.path !== "/webhook") {
    res.status(503).json({
      error: "Stripe is not configured. Set STRIPE_SECRET_KEY to enable payments.",
    });
    return;
  }
  next();
});

/**
 * Middleware to extract user from Supabase JWT (for HTTP routes)
 */
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
    let userEmail: string = "";

    // Try local JWT verification first (fast path)
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
      // Fallback: verify via Supabase getUser (works with all signing key types)
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

    // Attach user info to request
    (req as any).userId = userId;
    (req as any).userEmail = userEmail;

    next();
  } catch (error: any) {
    console.error("❌ Auth error:", error.message);
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

// ============================================
// POST /api/stripe/create-checkout
// Creates a Stripe Checkout session for subscription
// ============================================
router.post(
  "/create-checkout",
  authenticateRequest,
  async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId;
      const email = (req as any).userEmail;

      if (!config.stripe.priceId) {
        res.status(500).json({ error: "Stripe price ID not configured" });
        return;
      }

      // Get or create Stripe customer
      const customerId = await stripeService.getOrCreateCustomer(userId, email);

      // Build URLs
      const frontendUrl = config.frontendUrl;
      const successUrl = `${frontendUrl}/dashboard?subscription=success`;
      const cancelUrl = `${frontendUrl}/pricing?subscription=canceled`;

      // Create checkout session
      const checkoutUrl = await stripeService.createCheckoutSession(
        customerId,
        userId,
        successUrl,
        cancelUrl,
      );

      res.json({ url: checkoutUrl });
    } catch (error: any) {
      console.error("❌ Create checkout error:", error.message);
      res.status(500).json({ error: "Failed to create checkout session" });
    }
  },
);

// ============================================
// POST /api/stripe/portal
// Creates a Stripe Customer Portal session
// ============================================
router.post(
  "/portal",
  authenticateRequest,
  async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId;
      const email = (req as any).userEmail;

      const customerId = await stripeService.getOrCreateCustomer(userId, email);

      const returnUrl = `${config.frontendUrl}/dashboard`;
      const portalUrl = await stripeService.createPortalSession(
        customerId,
        returnUrl,
      );

      res.json({ url: portalUrl });
    } catch (error: any) {
      console.error("❌ Portal error:", error.message);
      res.status(500).json({ error: "Failed to create portal session" });
    }
  },
);

// ============================================
// GET /api/stripe/status
// Check subscription status for current user
// ============================================
router.get(
  "/status",
  authenticateRequest,
  async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId;
      const status = await stripeService.getSubscriptionStatus(userId);
      res.json(status);
    } catch (error: any) {
      console.error("❌ Status check error:", error.message);
      res.status(500).json({ error: "Failed to check subscription status" });
    }
  },
);

// ============================================
// POST /api/stripe/webhook
// Stripe webhook endpoint (uses raw body)
// ============================================
router.post("/webhook", async (req: Request, res: Response) => {
  try {
    const signature = req.headers["stripe-signature"] as string;

    if (!signature) {
      res.status(400).json({ error: "Missing stripe-signature header" });
      return;
    }

    // Verify and construct event
    const event = stripeService.verifyWebhookSignature(req.body, signature);

    // Process the event
    await stripeService.handleWebhookEvent(event);

    res.json({ received: true });
  } catch (error: any) {
    console.error("❌ Webhook error:", error.message);
    res.status(400).json({ error: `Webhook error: ${error.message}` });
  }
});

export default router;
