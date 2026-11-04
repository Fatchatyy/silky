import { eq, and, inArray, desc, sql } from 'drizzle-orm';
import { db } from '../db/orm.js';
import { orders, orderItems, orderExchanges, exchangeItems, orderRefunds, refundItems, productVariants, products, governorates } from '../models/index.js';

function parseCustomerName(fullName = '') {
  const parts = (fullName || '').trim().split(/\s+/);
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' ') || '',
  };
}

export function calculateOrderCustomerAmountToPay(order) {
  return parseFloat(order?.totalAmount ?? order?.total) || 0;
}

export function calculateExchangeCustomerAmountToPay(exchange, previousSubtotal = 0) {
  const newSubtotal = parseFloat(exchange?.subtotal) || 0;
  const prevSubtotal = parseFloat(previousSubtotal) || 0;
  const productDiff = Math.max(0, newSubtotal - prevSubtotal);
  const deliveryFee = parseFloat(exchange?.deliveryFee) || 0;
  return productDiff + deliveryFee;
}

export function calculateRefundCustomerAmountToPay(refund) {
  return parseFloat(refund?.deliveryFee) || 0;
}

// Retain calculatePayableAmount for any legacy callers, delegating to operation-specific calculation
export function calculatePayableAmount(params) {
  if (params && params.orderTotal !== undefined && !params.asOfDate && !params.asOfExchangeSequence && !params.exchanges?.length && !params.refunds?.length) {
    return parseFloat(params.orderTotal) || 0;
  }
  return parseFloat(params?.orderTotal) || 0;
}

function formatOrder(order, items = [], exchanges = [], refunds = [], gov = null) {
  if (!order) return null;
  const { firstName, lastName } = parseCustomerName(order.customerName);
  const orderCustomerAmount = calculateOrderCustomerAmountToPay(order);

  // Sort exchanges chronologically / by sequence to track previous subtotal accurately
  const sortedExchangesAsc = [...exchanges].sort((a, b) => {
    const seqA = a.exchangeSequence !== undefined && a.exchangeSequence !== null ? Number(a.exchangeSequence) : 0;
    const seqB = b.exchangeSequence !== undefined && b.exchangeSequence !== null ? Number(b.exchangeSequence) : 0;
    if (seqA !== seqB) return seqA - seqB;
    return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
  });

  const exchangeAmountMap = new Map();
  let runningPreviousSubtotal = parseFloat(order.subtotal) || 0;

  for (const ex of sortedExchangesAsc) {
    const exCustomerAmount = calculateExchangeCustomerAmountToPay(ex, runningPreviousSubtotal);
    exchangeAmountMap.set(ex.id, exCustomerAmount);
    runningPreviousSubtotal = parseFloat(ex.subtotal) || 0;
  }

  const govName = gov?.name || '';
  const streetAddress = order.shippingAddress || '';
  const fullAddress = govName
    ? (streetAddress.startsWith(`${govName} — `) ? streetAddress : `${govName} — ${streetAddress}`)
    : streetAddress;

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    userId: order.userId,
    guestSessionId: order.guestSessionId,
    governorateId: order.governorateId,
    governorate: gov ? { id: gov.id, name: gov.name, code: gov.code } : null,
    customer: {
      firstName,
      lastName,
      name: order.customerName,
      email: order.customerEmail,
      phone: order.customerPhone,
      address: fullAddress, // Presentation-time composed address
      shippingAddress: streetAddress,
      streetAddress,
      governorate: govName,
      governorateId: order.governorateId,
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
    subtotal: parseFloat(order.subtotal),
    deliveryFee: parseFloat(order.deliveryFee),
    total: parseFloat(order.totalAmount),
    customerAmountToPay: orderCustomerAmount,
    finalCustomerPayableAmount: orderCustomerAmount,
    status: order.status === 'processing' ? 'pending' : order.status,
    exchanges: exchanges.map((e) => {
      const { firstName: exFirst, lastName: exLast } = parseCustomerName(e.customerName);
      const exPayable = exchangeAmountMap.has(e.id)
        ? exchangeAmountMap.get(e.id)
        : calculateExchangeCustomerAmountToPay(e, order.subtotal);

      return {
        id: e.id,
        exchangeNumber: e.exchangeNumber,
        exchangeSequence: e.exchangeSequence,
        paymentResponsibility: e.paymentResponsibility || 'customer_paid',
        customer: {
          firstName: exFirst,
          lastName: exLast,
          name: e.customerName,
          email: e.customerEmail,
          phone: e.customerPhone,
          address: e.shippingAddress,
        },
        items: (e.items || []).map((ei) => ({
          id: ei.id,
          variantId: ei.variantId,
          name: ei.productTitle,
          variantLabel: ei.variantLabel,
          image: ei.imageUrl,
          quantity: ei.quantity,
          price: parseFloat(ei.unitPrice),
          total: parseFloat(ei.unitPrice) * ei.quantity,
        })),
        subtotal: parseFloat(e.subtotal),
        deliveryFee: parseFloat(e.deliveryFee),
        total: parseFloat(e.totalAmount),
        productAmountAdded: parseFloat(e.productAmountAdded) || 0,
        productRefundObligation: parseFloat(e.productRefundObligation) || 0,
        customerAmountToPay: exPayable,
        finalCustomerPayableAmount: exPayable,
        createdAt: e.createdAt,
      };
    }),
    refunds: refunds.map((r) => {
      const refPayable = calculateRefundCustomerAmountToPay(r);

      return {
        id: r.id,
        refundNumber: r.refundNumber,
        paymentResponsibility: r.paymentResponsibility || (parseFloat(r.deliveryFee) === 0 ? 'silky_paid' : 'customer_paid'),
        refundAmount: parseFloat(r.refundAmount),
        deliveryFee: parseFloat(r.deliveryFee),
        carrierCost: parseFloat(r.carrierCost),
        customerAmountToPay: refPayable,
        finalCustomerPayableAmount: refPayable,
        customer: {
          name: r.customerName,
          email: r.customerEmail,
          phone: r.customerPhone,
          address: r.shippingAddress,
        },
        items: (r.items || []).map((ri) => ({
          id: ri.id,
          variantId: ri.variantId,
          name: ri.productTitle,
          variantLabel: ri.variantLabel,
          image: ri.imageUrl,
          quantity: ri.quantity,
          price: parseFloat(ri.unitPrice),
          total: parseFloat(ri.unitPrice) * ri.quantity,
        })),
        createdAt: r.createdAt,
      };
    }),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

// Ids are sent to the database in slices, so a very large list never exceeds the number of parameters one query accepts.
const ID_SLICE = 5000;
async function selectForIds(ids, load) {
  const rows = [];
  for (let i = 0; i < ids.length; i += ID_SLICE) {
    rows.push(...(await load(ids.slice(i, i + ID_SLICE))));
  }
  return rows;
}

const groupBy = (list, key) => {
  const map = new Map();
  for (const item of list) {
    if (!map.has(item[key])) map.set(item[key], []);
    map.get(item[key]).push(item);
  }
  return map;
};

/**
 * Same result as calling findById for each order row, but the items, exchanges, refunds and governorates of all the
 * orders are read with a handful of queries instead of several per order.
 */
async function loadFullOrders(orderRows, tx) {
  if (!orderRows.length) return [];
  const orderIds = orderRows.map((o) => o.id);
  const governorateIds = [...new Set(orderRows.map((o) => o.governorateId).filter(Boolean))];

  const [govRows, itemRows, exchangeRows, refundRows] = await Promise.all([
    selectForIds(governorateIds, (ids) => tx.select().from(governorates).where(inArray(governorates.id, ids))),
    selectForIds(orderIds, (ids) => tx.select().from(orderItems).where(inArray(orderItems.orderId, ids))),
    selectForIds(orderIds, (ids) => tx.select().from(orderExchanges).where(inArray(orderExchanges.orderId, ids)).orderBy(desc(orderExchanges.createdAt))),
    selectForIds(orderIds, (ids) => tx.select().from(orderRefunds).where(inArray(orderRefunds.orderId, ids)).orderBy(desc(orderRefunds.createdAt))),
  ]);

  const [exchangeItemRows, refundItemRows] = await Promise.all([
    selectForIds(exchangeRows.map((e) => e.id), (ids) => tx.select().from(exchangeItems).where(inArray(exchangeItems.exchangeId, ids))),
    selectForIds(refundRows.map((r) => r.id), (ids) => tx.select().from(refundItems).where(inArray(refundItems.refundId, ids))),
  ]);

  const govById = new Map(govRows.map((g) => [g.id, g]));
  const itemsByOrder = groupBy(itemRows, 'orderId');
  const exchangeItemsBy = groupBy(exchangeItemRows, 'exchangeId');
  const refundItemsBy = groupBy(refundItemRows, 'refundId');
  const exchangesByOrder = groupBy(
    exchangeRows.map((ex) => ({ ...ex, items: exchangeItemsBy.get(ex.id) || [] })),
    'orderId',
  );
  const refundsByOrder = groupBy(
    refundRows.map((ref) => ({ ...ref, items: refundItemsBy.get(ref.id) || [] })),
    'orderId',
  );

  return orderRows.map((order) =>
    formatOrder(
      order,
      itemsByOrder.get(order.id) || [],
      exchangesByOrder.get(order.id) || [],
      refundsByOrder.get(order.id) || [],
      order.governorateId ? govById.get(order.governorateId) || null : null,
    ),
  );
}

export const orderRepository = {
  async findAll(options = {}, tx = db) {
    const orderRows = await tx.select().from(orders).orderBy(desc(orders.createdAt));
    return loadFullOrders(orderRows, tx);
  },

  async findByUserId(userId, tx = db) {
    if (!userId) return [];
    const orderRows = await tx.select().from(orders).where(eq(orders.userId, userId)).orderBy(desc(orders.createdAt));

    const result = [];
    for (const o of orderRows) {
      const full = await this.findById(o.id, tx);
      if (full) result.push(full);
    }
    return result;
  },

  async findById(id, tx = db) {
    if (!id) return null;
    const [order] = await tx.select().from(orders).where(eq(orders.id, id));
    if (!order) return null;

    let gov = null;
    if (order.governorateId) {
      const [govRow] = await tx.select().from(governorates).where(eq(governorates.id, order.governorateId));
      gov = govRow || null;
    }

    const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, id));

    const exchangeRows = await tx.select().from(orderExchanges)
      .where(eq(orderExchanges.orderId, id))
      .orderBy(desc(orderExchanges.createdAt));

    const fullExchanges = [];
    for (const ex of exchangeRows) {
      const eItems = await tx.select().from(exchangeItems).where(eq(exchangeItems.exchangeId, ex.id));
      fullExchanges.push({ ...ex, items: eItems });
    }

    const refundRows = await tx.select().from(orderRefunds)
      .where(eq(orderRefunds.orderId, id))
      .orderBy(desc(orderRefunds.createdAt));

    const fullRefunds = [];
    for (const ref of refundRows) {
      const rItems = await tx.select().from(refundItems).where(eq(refundItems.refundId, ref.id));
      fullRefunds.push({ ...ref, items: rItems });
    }

    return formatOrder(order, items, fullExchanges, fullRefunds, gov);
  },

  async findByIdForUpdate(id, tx = db) {
    if (!id) return null;
    const [order] = await tx.select().from(orders).where(eq(orders.id, id)).for('update');
    return order || null;
  },

  async lockVariantsForUpdate(variantIds, tx = db) {
    if (!variantIds || variantIds.length === 0) return [];
    return tx.select().from(productVariants).where(inArray(productVariants.id, variantIds)).for('update');
  },

  async createOrder({ orderNumber, userId = null, guestSessionId = null, customerName, customerEmail = null, customerPhone, governorateId, shippingAddress, subtotal, deliveryFee = 0, totalAmount, status = 'pending' }, items = [], tx = db) {
    const [newOrder] = await tx.insert(orders).values({
      orderNumber,
      userId,
      guestSessionId,
      customerName,
      customerEmail,
      customerPhone,
      governorateId,
      shippingAddress,
      subtotal: subtotal.toString(),
      deliveryFee: deliveryFee.toString(),
      totalAmount: totalAmount.toString(),
      status,
    }).returning();

    for (const item of items) {
      await tx.insert(orderItems).values({
        orderId: newOrder.id,
        variantId: item.variantId || null,
        productTitle: item.name || item.productTitle,
        variantLabel: item.variantLabel || null,
        imageUrl: item.image || item.imageUrl || null,
        quantity: item.quantity,
        unitPrice: item.price.toString(),
      });
    }

    return this.findById(newOrder.id, tx);
  },

  async updateStatus(id, status, tx = db) {
    const [updated] = await tx.update(orders)
      .set({ status, updatedAt: new Date() })
      .where(eq(orders.id, id))
      .returning();
    return updated || null;
  }
};
