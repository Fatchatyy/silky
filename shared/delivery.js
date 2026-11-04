// Customer-facing delivery fee in TND, shown in the shop's text pages (delivery page, FAQ, terms of sale).
// It must equal server/config/delivery.js DEFAULT_CUSTOMER_DELIVERY_FEE, the amount actually charged on orders;
// server/scripts/test_seo_builders.js fails if the two differ. Change both together (e.g. new delivery company).
export const DELIVERY_FEE_TND = 8;
