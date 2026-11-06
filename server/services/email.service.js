import nodemailer from "nodemailer";
import fs from "node:fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { env } from "../config/env.js";
import { getPasswordResetEmail } from "../emails/password-reset.email.js";
import { getWelcomeEmail } from "../emails/welcome.email.js";
import { getContactReplyEmail } from "../emails/contact-reply.email.js";
import { getOrderConfirmationEmail } from "../emails/order-confirmation.email.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Absolute path to the Silky logo used as an inline CID attachment in all
 * branded emails. Resolved relative to this file so it works from any cwd.
 */
const LOGO_PATH = path.resolve(__dirname, '../assets/logo.png');

let _transporter = null;

/**
 * How e-mail is sent:
 * - 'resend': RESEND_API_KEY is set (real delivery over HTTPS; wins over SMTP when both are set). Needed on hosts that
 *   block the SMTP ports, such as Render's free plan.
 * - 'smtp': SMTP credentials are set (real delivery).
 * - 'ethereal': no credentials, development only (a fake inbox, nothing reaches a customer).
 * - 'off': no credentials in production. Ethereal is a public test service, so customer e-mails (name, address,
 *   phone) must never be sent to it from the live shop; sending fails instead and the callers log it.
 */
export function resolveMailMode({ smtpUser, smtpPass, resendApiKey, isProduction }) {
  if (resendApiKey) return 'resend';
  if (smtpUser && smtpPass) return 'smtp';
  return isProduction ? 'off' : 'ethereal';
}

const RESEND_TIMEOUT_MS = 15000;

/**
 * A transporter with the one method this module uses (sendMail) that sends through Resend's HTTPS API. It takes the
 * nodemailer-style options built in sendEmail and answers { messageId } like nodemailer does. The API key is only ever
 * sent in the Authorization header and is never logged; errors carry Resend's own message (it holds no customer data).
 */
export function createResendTransport({ apiKey, apiUrl, fetchImpl = fetch }) {
  return {
    async sendMail(options) {
      const body = {
        from: options.from,
        to: [options.to],
        subject: options.subject,
        html: options.html,
        text: options.text,
      };
      if (options.replyTo) body.reply_to = options.replyTo;
      if (options.attachments?.length) {
        body.attachments = await Promise.all(
          options.attachments.map(async (file) => ({
            filename: file.filename,
            content: (file.content ? Buffer.from(file.content) : await fs.readFile(file.path)).toString('base64'),
            ...(file.contentType ? { content_type: file.contentType } : {}),
            ...(file.cid ? { content_id: file.cid } : {}),
          })),
        );
      }

      let res;
      try {
        res = await fetchImpl(`${apiUrl}/emails`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
        });
      } catch (err) {
        throw new Error(`Resend est injoignable (${err?.name === 'TimeoutError' ? 'délai dépassé' : String(err?.message ?? err).slice(0, 120)}).`);
      }

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = String(payload?.message || payload?.error || res.statusText || 'erreur').slice(0, 200);
        throw new Error(`Resend a refusé l'e-mail (HTTP ${res.status}): ${detail}`);
      }
      return { messageId: payload.id };
    },
  };
}

/**
 * Build (and cache) the mail transporter.
 * - RESEND_API_KEY set: Resend over HTTPS.
 * - When SMTP credentials are set: uses real SMTP.
 * - Without credentials outside production: falls back to Ethereal (fake SMTP) and logs a preview URL.
 * - Without credentials in production: throws (see resolveMailMode).
 */
export async function getTransporter() {
  if (_transporter) return _transporter;

  const mode = resolveMailMode(env);
  if (mode === 'off') {
    throw new Error("L'envoi d'e-mails n'est pas configuré (RESEND_API_KEY, ou SMTP_USER et SMTP_PASS, sont manquants).");
  }

  if (mode === 'resend') {
    _transporter = createResendTransport({ apiKey: env.resendApiKey, apiUrl: env.resendApiUrl });
  } else if (mode === 'smtp') {
    _transporter = nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpSecure,
      auth: {
        user: env.smtpUser,
        pass: env.smtpPass,
      },
    });
  } else {
    const testAccount = await nodemailer.createTestAccount();
    _transporter = nodemailer.createTransport({
      host: "smtp.ethereal.email",
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });
    console.log("[email] No SMTP credentials found — using Ethereal test account.");
    console.log(`[email] Ethereal inbox: https://ethereal.email/login`);
    console.log(`[email] User: ${testAccount.user}  Pass: ${testAccount.pass}`);
  }

  return _transporter;
}

/**
 * Centralized email sending function.
 * @param {Object} options
 * @param {string} options.to - Recipient email address.
 * @param {string} options.subject - Subject line.
 * @param {string} options.html - HTML email body.
 * @param {string} [options.text] - Plain text fallback.
 */
export async function sendEmail({ to, subject, html, text, replyTo }) {
  if (!to || typeof to !== 'string' || !to.trim()) {
    throw new Error("L'adresse du destinataire est requise pour envoyer un e-mail.");
  }

  const transport = await getTransporter();

  const mailOptions = {
    from: env.emailFrom,
    to: to.trim(),
    subject,
    text,
    html,
    /**
     * Inline CID attachment for the Silky logo.
     * Referenced in layout.js as <img src="cid:silky-logo">.
     * Adding it here once means every branded email template gets the
     * logo automatically — no per-template changes required.
     */
    attachments: [
      {
        filename: 'logo.png',
        path: LOGO_PATH,
        cid: 'silky-logo',
        contentType: 'image/png',
        contentDisposition: 'inline',
      },
    ],
  };

  const resolvedReplyTo = replyTo || env.emailReplyTo;
  if (resolvedReplyTo) {
    mailOptions.replyTo = resolvedReplyTo;
  }

  const info = await transport.sendMail(mailOptions);

  const preview = nodemailer.getTestMessageUrl(info);
  if (preview) {
    console.log(`[email] Preview URL: ${preview}`);
  } else {
    console.log(`[email] Email sent to ${to} (subject: "${subject}", messageId: ${info.messageId})`);
  }

  return info;
}

/**
 * Send a password-reset email.
 * @param {string} to       - Recipient email address.
 * @param {string} rawToken - The raw (unhashed) reset token.
 */
export async function sendPasswordResetEmail(to, rawToken) {
  const { subject, html, text } = getPasswordResetEmail({ rawToken });
  return sendEmail({ to, subject, html, text });
}

/**
 * Send a welcome email to a newly registered customer.
 * @param {string} to   - Recipient email address.
 * @param {string} name - Customer full name.
 */
export async function sendWelcomeEmail(to, name) {
  const { subject, html, text } = getWelcomeEmail({ name });
  return sendEmail({ to, subject, html, text });
}

/**
 * Send an admin reply email to a contact message.
 * @param {string} to - Recipient email address.
 * @param {Object} params
 * @param {string} params.recipientName - Customer full name.
 * @param {string} params.subject - Email subject.
 * @param {string} params.message - Reply message text.
 */
export async function sendContactReplyEmail(to, { recipientName, subject, message }) {
  const { subject: replySubject, html, text } = getContactReplyEmail({
    recipientName,
    subject,
    message,
  });
  return sendEmail({ to, subject: replySubject, html, text });
}

let _orderConfirmationHook = null;
let _orderConfirmationMockSender = null;

/**
 * For testing and telemetry: register a hook called whenever an order confirmation email is dispatched.
 */
export function setOrderConfirmationEmailHook(hook) {
  _orderConfirmationHook = hook;
}

/**
 * For testing: override the email sender function to simulate failures.
 */
export function setMockOrderConfirmationSender(senderFn) {
  _orderConfirmationMockSender = senderFn;
}

/**
 * Send an order confirmation & invoice email.
 * @param {Object} order - Full server-side order object.
 */
export async function sendOrderConfirmationEmail(order) {
  if (typeof _orderConfirmationHook === 'function') {
    _orderConfirmationHook(order);
  }

  if (typeof _orderConfirmationMockSender === 'function') {
    return _orderConfirmationMockSender(order);
  }

  const recipientEmail = order?.customer?.email || order?.customerEmail;
  if (!recipientEmail) {
    throw new Error("L'adresse e-mail du client est manquante dans la commande.");
  }

  const { subject, html, text } = getOrderConfirmationEmail(order);
  return sendEmail({ to: recipientEmail, subject, html, text });
}

