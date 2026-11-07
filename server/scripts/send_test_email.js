/**
 * Sends ONE test e-mail with the mail settings of server/.env, to check that real delivery works (Resend, SMTP or the
 * Ethereal fake inbox in development). It prints the mode, the sender and the provider's id; it never prints a key.
 *
 * Usage (inside server/):
 *   node scripts/send_test_email.js you@example.com
 *
 * With Resend and no verified domain yet, use EMAIL_FROM="Silky <onboarding@resend.dev>" and send to the address you
 * signed up to Resend with (Resend refuses any other recipient until a domain is verified).
 */
import { env } from '../config/env.js';
import { resolveMailMode, sendEmail } from '../services/email.service.js';

const to = process.argv[2];
if (!to || !to.includes('@')) {
  console.error('Usage: node scripts/send_test_email.js you@example.com');
  process.exit(2);
}

const mode = resolveMailMode(env);
console.log(`Mail mode: ${mode}`);
console.log(`From: ${env.emailFrom}`);
console.log(`To: ${to}`);
if (mode === 'off') {
  console.error('Nothing is configured (no RESEND_API_KEY, no SMTP credentials) and NODE_ENV=production: nothing sent.');
  process.exit(1);
}

try {
  const info = await sendEmail({
    to,
    subject: 'Silky: e-mail de test',
    text: 'Ceci est un e-mail de test envoyé par le serveur Silky. Si vous le lisez, l\'envoi fonctionne.',
    html: '<p>Ceci est un e-mail de test envoyé par le serveur Silky.</p><p>Si vous le lisez, l\'envoi fonctionne.</p><p><img src="cid:silky-logo" alt="Silky" width="120"></p>',
    replyTo: env.emailReplyTo,
  });
  console.log(`Sent. Provider id: ${info.messageId}`);
  console.log('Now check the inbox (and the spam folder), and that the logo shows.');
} catch (err) {
  console.error(`Sending failed: ${err.message}`);
  process.exitCode = 1;
}
