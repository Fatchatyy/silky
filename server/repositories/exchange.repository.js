import { eq, desc, sql } from 'drizzle-orm';
import { db } from '../db/orm.js';
import { orderExchanges, exchangeItems } from '../models/index.js';

export const exchangeRepository = {
  async findByOrderId(orderId, tx = db) {
    const exchanges = await tx.select().from(orderExchanges)
      .where(eq(orderExchanges.orderId, orderId))
      .orderBy(desc(orderExchanges.createdAt));

    const result = [];
    for (const ex of exchanges) {
      const items = await tx.select().from(exchangeItems).where(eq(exchangeItems.exchangeId, ex.id));
      result.push({
        id: ex.id,
        exchangeNumber: ex.exchangeNumber,
        exchangeSequence: ex.exchangeSequence,
        paymentResponsibility: ex.paymentResponsibility || 'customer_paid',
        customer: {
          name: ex.customerName,
          email: ex.customerEmail,
          phone: ex.customerPhone,
          address: ex.shippingAddress,
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
        subtotal: parseFloat(ex.subtotal),
        deliveryFee: parseFloat(ex.deliveryFee),
        total: parseFloat(ex.totalAmount),
        productAmountAdded: parseFloat(ex.productAmountAdded) || 0,
        productRefundObligation: parseFloat(ex.productRefundObligation) || 0,
        createdAt: ex.createdAt,
      });
    }
    return result;
  },

  async findLatestExchange(orderId, tx = db) {
    const [latest] = await tx.select().from(orderExchanges)
      .where(eq(orderExchanges.orderId, orderId))
      .orderBy(desc(orderExchanges.exchangeSequence))
      .limit(1);

    if (!latest) return null;

    const items = await tx.select().from(exchangeItems).where(eq(exchangeItems.exchangeId, latest.id));
    return {
      ...latest,
      paymentResponsibility: latest.paymentResponsibility || 'customer_paid',
      items,
    };
  },

  async findById(id, tx = db) {
    const [row] = await tx.select().from(orderExchanges).where(eq(orderExchanges.id, id));
    return row || null;
  },

  async createExchangeRecord({ orderId, exchangeNumber, exchangeSequence, paymentResponsibility = 'customer_paid', customerName, customerEmail = null, customerPhone, shippingAddress, subtotal, deliveryFee = 0, totalAmount, productAmountAdded = 0, productRefundObligation = 0 }, items = [], tx = db) {
    const [newExchange] = await tx.insert(orderExchanges).values({
      orderId,
      exchangeNumber,
      exchangeSequence,
      paymentResponsibility,
      customerName,
      customerEmail,
      customerPhone,
      shippingAddress,
      subtotal: subtotal.toString(),
      deliveryFee: deliveryFee.toString(),
      totalAmount: totalAmount.toString(),
      productAmountAdded: (productAmountAdded || 0).toString(),
      productRefundObligation: (productRefundObligation || 0).toString(),
    }).returning();

    for (const item of items) {
      await tx.insert(exchangeItems).values({
        exchangeId: newExchange.id,
        variantId: item.variantId || null,
        productTitle: item.name || item.productTitle,
        variantLabel: item.variantLabel || null,
        imageUrl: item.image || item.imageUrl || null,
        quantity: item.quantity,
        unitPrice: item.price.toString(),
      });
    }

    return newExchange;
  }
};
