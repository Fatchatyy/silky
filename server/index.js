import './config/env.js';
import { app, ensureUploadsDir, env } from './app.js';
import { verifyConnection, pool } from './db/pool.js';
import { runExchangesMigration } from './db/migrations/add_exchanges.js';
import { runRefundsMigration } from './db/migrations/add_refunds.js';
import { runAnnouncementsMigration } from './db/migrations/add_announcements.js';
import { runFavouritesVariantMigration } from './db/migrations/add_favourites_variant.js';
import { runIdempotencyKeysMigration } from './db/migrations/add_idempotency_keys.js';
import { runNotificationsMigration } from './db/migrations/add_notifications.js';
import { runRemoveOrderSourceMigration } from './db/migrations/remove_order_source.js';
import { runProductVideosMigration } from './db/migrations/add_product_videos.js';
import { runProductArabicContentMigration } from './db/migrations/add_product_arabic_content.js';
import { runProductImageAltMigration } from './db/migrations/add_product_image_alt.js';
import { runVariantPositionMigration } from './db/migrations/add_variant_position.js';
import { runHeroConfigMigration } from './db/migrations/add_hero_config.js';
import { runReviewIdentityFieldsMigration } from './db/migrations/add_review_identity_fields.js';
import { runStoreReviewIdentityFieldsMigration } from './db/migrations/add_store_review_identity_fields.js';
import { runContactMessageGuestSessionMigration } from './db/migrations/add_contact_message_guest_session.js';
import { runUsersIdentityCheckMigration } from './db/migrations/add_users_identity_check.js';
import { runDraftTablesMigration } from './db/migrations/add_draft_tables.js';
import { runGovernoratesMigration } from './db/migrations/add_governorates.js';
import { runDeliveredStatusMigration } from './db/migrations/add_delivered_status.js';
import { runExchangeFinancialDifferenceFieldsMigration } from './db/migrations/add_exchange_financial_difference_fields.js';
import { runOrderDeliveriesMigration } from './db/migrations/add_order_deliveries.js';
import { runOrderClaimsMigration } from './db/migrations/add_order_claims.js';
import { runExchangeDeliveriesMigration } from './db/migrations/add_exchange_deliveries.js';
import { runRefundDeliveriesMigration } from './db/migrations/add_refund_deliveries.js';
import { runUsersTokensValidAfterMigration } from './db/migrations/add_users_tokens_valid_after.js';
import { runPublishStateMigration } from './db/migrations/add_publish_state.js';
import { missingApiConfig, missingWebhookConfig } from './config/goodex.js';
import { resolveMailMode } from './services/email.service.js';
import { installProcessSafetyHandlers } from './utils/processSafety.js';
import { startDeliveryReconciler, stopDeliveryReconciler } from './services/delivery.reconciler.js';

installProcessSafetyHandlers();

async function start() {
  await ensureUploadsDir();
  await verifyConnection();
  await runExchangesMigration(pool);
  await runRefundsMigration(pool);
  await runAnnouncementsMigration(pool);
  await runHeroConfigMigration(pool);
  await runFavouritesVariantMigration(pool);
  await runIdempotencyKeysMigration(pool);
  await runNotificationsMigration(pool);
  await runRemoveOrderSourceMigration(pool);
  await runProductVideosMigration(pool);
  await runProductArabicContentMigration(pool);
  await runProductImageAltMigration(pool);
  await runVariantPositionMigration(pool);
  await runReviewIdentityFieldsMigration(pool);
  await runStoreReviewIdentityFieldsMigration(pool);
  await runContactMessageGuestSessionMigration(pool);
  await runUsersIdentityCheckMigration(pool);
  await runDraftTablesMigration(pool);
  await runGovernoratesMigration(pool);
  await runDeliveredStatusMigration(pool);
  await runExchangeFinancialDifferenceFieldsMigration(pool);
  await runOrderDeliveriesMigration(pool);
  await runOrderClaimsMigration(pool);
  await runExchangeDeliveriesMigration(pool);
  await runRefundDeliveriesMigration(pool);
  await runUsersTokensValidAfterMigration(pool);
  await runPublishStateMigration(pool);

  if (resolveMailMode(env) === 'off') {
    console.warn('[email] RESEND_API_KEY (or SMTP_USER / SMTP_PASS) is not set in production: no e-mail (order confirmation, password reset, welcome, contact reply) will be sent until they are.');
  }

  const missingGoodex = [...missingApiConfig(), ...missingWebhookConfig()];
  if (missingGoodex.length) {
    console.warn(`[goodex] Not configured, parcel creation/tracking/webhook disabled until set: ${missingGoodex.join(', ')}`);
  }

  const server = app.listen(env.port, () => {
    console.log(`Silky API running on http://localhost:${env.port}`);
    console.log(`Admin email: ${env.adminEmail} (seed with npm run db:seed)`);
  });

  // Background GOODEX status reconciliation (read-only). Lives here, not in app.js, so tests that
  // import the app never start a timer. It stays off until GOODEX_POLL_INTERVAL_MINUTES is set to a number of minutes.
  startDeliveryReconciler();

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received, shutting down`);
    await stopDeliveryReconciler();
    server.close(async () => {
      await pool.end().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 10000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((err) => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});
