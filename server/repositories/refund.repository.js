import { eq, desc } from 'drizzle-orm';
import { db } from '../db/orm.js';
import { orderRefunds, refundItems } from '../models/index.js';
import { DELIVERY_ECONOMICS } from '../config/delivery.js';

export const refundRepository = {
  async findByOrderId(orderId, tx = db) {
    const refunds = await tx.select().from(orderRefunds)
      .where(eq(orderRefunds.orderId, orderId))
      .orderBy(desc(orderRefunds.createdAt));

    const result = [];
    for (const ref of refunds) {
      const items = await tx.select().from(refundItems).where(eq(refundItems.refundId, ref.id));
      result.push({
        id: ref.id,
        refundNumber: ref.refundNumber,
        paymentResponsibility: ref.paymentResponsibility || (parseFloat(ref.deliveryFee) === 0 ? 'silky_paid' : 'customer_paid'),
        customer: {
          name: ref.customerName,
          email: ref.customerEmail,
          phone: ref.customerPhone,
          address: ref.shippingAddress,
        },
        items: items.map((i) => ({
          id: i.id,
          variantId: i.variantId,
          name: i.productTitle,
          variantLabel: i.variantLabel,
          image: i.imageUrl,
          quantity: i.quantity,
          price: parseFloat(i.unitPrice),
          total: parseFloat(i.unitPrice) * i.quantity,
        })),
        refundAmount: parseFloat(ref.refundAmount),
        deliveryFee: parseFloat(ref.deliveryFee),
        carrierCost: parseFloat(ref.carrierCost),
        customerAmountToPay: parseFloat(ref.deliveryFee),
        finalCustomerPayableAmount: parseFloat(ref.deliveryFee),
        createdAt: ref.createdAt,
      });
    }
    return result;
  },

  /** The stored refund row (no items), or null. */
  async findById(id, tx = db) {
    const [row] = await tx.select().from(orderRefunds).where(eq(orderRefunds.id, id));
    return row || null;
  },

  async findLatestRefund(orderId, tx = db) {
    const [latest] = await tx.select().from(orderRefunds)
      .where(eq(orderRefunds.orderId, orderId))
      .orderBy(desc(orderRefunds.createdAt))
      .limit(1);

    if (!latest) return null;

    const items = await tx.select().from(refundItems).where(eq(refundItems.refundId, latest.id));
    return {
      ...latest,
      paymentResponsibility: latest.paymentResponsibility || (parseFloat(latest.deliveryFee) === 0 ? 'silky_paid' : 'customer_paid'),
      refundAmount: parseFloat(latest.refundAmount),
      deliveryFee: parseFloat(latest.deliveryFee),
      carrierCost: parseFloat(latest.carrierCost),
      customerAmountToPay: parseFloat(latest.deliveryFee),
      finalCustomerPayableAmount: parseFloat(latest.deliveryFee),
      items,
    };
  },

  async createRefundRecord({
    orderId,
    refundNumber,
    paymentResponsibility = DELIVERY_ECONOMICS.RESPONSIBILITIES.CUSTOMER_PAID,
    customerName,
    customerEmail = null,
    customerPhone,
    shippingAddress,
    refundAmount,
    deliveryFee = DELIVERY_ECONOMICS.REFUND_CUSTOMER_DELIVERY_FEE,
    carrierCost = DELIVERY_ECONOMICS.CARRIER_COST_REFUND_DELIVERY,
  }, items = [], tx = db) {
    const [newRefund] = await tx.insert(orderRefunds).values({
      orderId,
      refundNumber,
      paymentResponsibility,
      customerName,
      customerEmail,
      customerPhone,
      shippingAddress,
      refundAmount: refundAmount.toString(),
      deliveryFee: deliveryFee.toString(),
      carrierCost: carrierCost.toString(),
    }).returning();

    for (const item of items) {
      await tx.insert(refundItems).values({
        refundId: newRefund.id,
        variantId: item.variantId || null,
        productTitle: item.name || item.productTitle,
        variantLabel: item.variantLabel || item.details || null,
        imageUrl: item.image || item.imageUrl || null,
        quantity: item.quantity,
        unitPrice: (item.price || item.unitPrice).toString(),
      });
    }

    return newRefund;
  }
};
