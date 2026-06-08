// functions/index.js
// Firebase Cloud Functions for GasLedger
//
// 1. onInviteCreated   — sends branded email when owner invites staff
// 2. paystackWebhook   — verifies Paystack payment and updates plan in Firestore

const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onRequest }         = require("firebase-functions/v2/https");
const { setGlobalOptions }  = require("firebase-functions/v2");
const { initializeApp }     = require("firebase-admin/app");
const { getFirestore }      = require("firebase-admin/firestore");
const nodemailer            = require("nodemailer");
const crypto                = require("crypto");

initializeApp();
setGlobalOptions({ region: "europe-west1" });

// ─────────────────────────────────────────────────────────────
// 1. INVITE EMAIL
// ─────────────────────────────────────────────────────────────
const createTransporter = (gmailUser, gmailPass) =>
  nodemailer.createTransport({
    service: "gmail",
    auth: { user: gmailUser, pass: gmailPass },
  });

const buildEmail = ({ toEmail, plantName, appUrl }) => ({
  from: `"GasLedger" <${process.env.GMAIL_USER}>`,
  to:   toEmail,
  subject: `You've been invited to manage ${plantName} on GasLedger`,
  html: `
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f1f4f2;font-family:-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:#fff;border-radius:16px;overflow:hidden;">
        <tr><td style="background:#0d3b2e;padding:28px 28px 24px;">
          <div style="font-size:20px;font-weight:700;color:#fff;">⛽ GasLedger</div>
          <div style="font-size:12px;color:rgba(255,255,255,.5);margin-top:2px;">LPG plant management</div>
        </td></tr>
        <tr><td style="padding:28px;">
          <h2 style="margin:0 0 8px;font-size:20px;color:#111;">You've been invited</h2>
          <p style="margin:0 0 20px;font-size:14px;color:#555;line-height:1.6;">
            <strong>${plantName}</strong> has added you as a staff member on GasLedger.
          </p>
          <div style="background:#f1f4f2;border-radius:10px;padding:16px;margin-bottom:20px;">
            <div style="font-size:11px;font-weight:600;color:#6b7f78;text-transform:uppercase;letter-spacing:.6px;margin-bottom:12px;">As staff, you can</div>
            ${["Log daily meter entries","View dashboard and history","Submit end-of-day cash remittance"].map(f=>`
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
              <div style="width:18px;height:18px;background:#dcfce7;border-radius:50%;text-align:center;line-height:18px;font-size:10px;color:#166534;">✓</div>
              <span style="font-size:13px;color:#111;">${f}</span>
            </div>`).join("")}
          </div>
          <div style="text-align:center;margin-bottom:24px;">
            <a href="${appUrl}" style="display:inline-block;background:#0d3b2e;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:13px 28px;border-radius:10px;">
              Accept invitation →
            </a>
          </div>
          <div style="border:1px solid #e0e7e4;border-radius:10px;padding:16px;">
            <div style="font-size:11px;font-weight:600;color:#6b7f78;margin-bottom:10px;">How to accept</div>
            <div style="font-size:13px;color:#555;line-height:1.7;">
              1. Open <a href="${appUrl}" style="color:#0d3b2e;">${appUrl}</a><br>
              2. Create an account using <strong>${toEmail}</strong><br>
              3. You'll be automatically linked to ${plantName}
            </div>
          </div>
        </td></tr>
        <tr><td style="background:#f1f4f2;padding:16px 28px;border-top:1px solid #e0e7e4;">
          <p style="margin:0;font-size:11px;color:#6b7f78;text-align:center;">
            Sent via GasLedger · <a href="${appUrl}" style="color:#0d3b2e;">${appUrl}</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>
  `.trim(),
});

exports.onInviteCreated = onDocumentCreated(
  { document: "invites/{inviteId}", secrets: ["GMAIL_USER","GMAIL_PASS"] },
  async (event) => {
    const data = event.data?.data();
    if (!data?.email || !data?.plantName) return;
    try {
      const transporter = createTransporter(process.env.GMAIL_USER, process.env.GMAIL_PASS);
      await transporter.sendMail(buildEmail({
        toEmail:   data.email,
        plantName: data.plantName,
        appUrl:    "https://gasledger.hggas.com.ng",
      }));
      console.log(`Invite email sent to ${data.email}`);
    } catch(err) {
      console.error(`Failed to send invite email:`, err.message);
    }
  }
);

// ─────────────────────────────────────────────────────────────
// 2. PAYSTACK WEBHOOK
// POST https://<region>-<project>.cloudfunctions.net/paystackWebhook
// ─────────────────────────────────────────────────────────────
exports.paystackWebhook = onRequest(
  { secrets: ["PAYSTACK_SECRET_KEY"] },
  async (req, res) => {
    // Only accept POST
    if (req.method !== "POST") { res.status(405).send("Method not allowed"); return; }

    // Verify Paystack signature
    const secret    = process.env.PAYSTACK_SECRET_KEY;
    const hash      = crypto.createHmac("sha512", secret).update(JSON.stringify(req.body)).digest("hex");
    const signature = req.headers["x-paystack-signature"];

    if (hash !== signature) {
      console.warn("Invalid Paystack signature");
      res.status(400).send("Invalid signature");
      return;
    }

    const event = req.body;

    // Handle successful payment
    if (event.event === "charge.success") {
      const { metadata, reference, amount } = event.data;
      const { uid, plantId, plan } = metadata || {};

      if (!uid || !plantId || !plan) {
        console.warn("Missing metadata in Paystack webhook:", metadata);
        res.status(200).send("OK"); // Acknowledge but skip
        return;
      }

      try {
        const db  = getFirestore();
        const now = new Date();

        // Calculate next billing date (30 days)
        const nextBilling = new Date(now);
        nextBilling.setDate(nextBilling.getDate() + 30);

        // Update user doc
        await db.collection("users").doc(uid).update({
          plan,
          planUpdatedAt:  now,
          paystackRef:    reference,
          amountPaid:     amount / 100, // convert from kobo
          nextBillingDate: nextBilling,
        });

        // Update plant doc
        await db.collection("plants").doc(plantId).update({
          plan,
          planUpdatedAt: now,
        });

        console.log(`Plan updated to ${plan} for user ${uid}, ref: ${reference}`);
      } catch(err) {
        console.error("Failed to update plan after payment:", err.message);
        res.status(500).send("Plan update failed");
        return;
      }
    }

    // Handle subscription cancellation / failed charges (optional — extend later)
    if (event.event === "subscription.disable" || event.event === "invoice.payment_failed") {
      const customerEmail = event.data?.customer?.email;
      console.log(`Subscription event ${event.event} for ${customerEmail}`);
      // TODO: downgrade to free plan
    }

    res.status(200).send("OK");
  }
);
