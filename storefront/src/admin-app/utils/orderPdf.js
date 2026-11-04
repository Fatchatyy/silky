import { jsPDF } from 'jspdf';

const formatPrice = (amount) =>
  (Number(amount) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + ' TND';

export function renderOrderDocument(doc, order) {
  const margin = 20;
  let y = margin;

  doc.setFontSize(20);
  doc.setTextColor(141, 25, 28);
  doc.setFont(undefined, 'normal');
  doc.text('Silky', margin, y);
  y += 10;

  doc.setFontSize(12);
  doc.setTextColor(0, 0, 0);
  doc.text(`Commande ${order.orderNumber || ''}`, margin, y);
  y += 6;

  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  const dateStr = order.createdAt ? new Date(order.createdAt).toLocaleString('fr-FR') : '';
  doc.text(`Date: ${dateStr}`, margin, y);
  y += 12;

  doc.setFontSize(11);
  doc.setTextColor(0, 0, 0);
  doc.text('Client', margin, y);
  y += 6;

  doc.setFontSize(10);
  const customer = order.customer || {};
  const firstName = customer.firstName || customer.name || '';
  const lastName = customer.lastName || '';
  const fullName = `${firstName} ${lastName}`.trim() || 'Client';

  doc.text(fullName, margin, y);
  y += 5;
  if (customer.email) {
    doc.text(customer.email, margin, y);
    y += 5;
  }
  if (customer.phone) {
    doc.text(customer.phone, margin, y);
    y += 5;
  }
  const addressLines = doc.splitTextToSize(customer.address || customer.shippingAddress || '', 170);
  doc.text(addressLines, margin, y);
  y += addressLines.length * 5 + 8;

  doc.setFontSize(11);
  doc.text('Articles', margin, y);
  y += 7;

  doc.setFontSize(9);
  const items = Array.isArray(order.items) ? order.items : [];
  items.forEach((item) => {
    const detailsStr = item.details || item.variantLabel ? ` (${item.details || item.variantLabel})` : '';
    const itemPrice = Number(item.price || item.unitPrice || 0);
    const line = `${item.name || item.productTitle}${detailsStr} x${item.quantity} — ${formatPrice(itemPrice * item.quantity)}`;
    const lines = doc.splitTextToSize(line, 170);
    doc.text(lines, margin, y);
    y += lines.length * 4 + 2;
    if (y > 260) {
      doc.addPage();
      y = margin;
    }
  });

  y += 6;
  doc.setDrawColor(200, 200, 200);
  doc.line(margin, y, 190, y);
  y += 8;

  doc.setFontSize(10);
  doc.text(`Sous-total: ${formatPrice(order.subtotal)}`, margin, y);
  y += 5;
  doc.text(`Livraison: ${formatPrice(order.deliveryFee)}`, margin, y);
  y += 7;
  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.text(`Total (TTC): ${formatPrice(order.total)}`, margin, y);
  y += 7;
  doc.setTextColor(141, 25, 28);
  const payable = order.customerAmountToPay !== undefined
    ? order.customerAmountToPay
    : (order.finalCustomerPayableAmount !== undefined ? order.finalCustomerPayableAmount : order.total);
  doc.text(`Montant à payer: ${formatPrice(payable)}`, margin, y);
  doc.setTextColor(0, 0, 0);
  doc.setFont(undefined, 'normal');
}

export function renderExchangeDocument(doc, exchange) {
  const margin = 20;
  let y = margin;

  // Header - Brand
  doc.setFontSize(20);
  doc.setTextColor(141, 25, 28);
  doc.setFont(undefined, 'normal');
  doc.text('Silky', margin, y);
  y += 10;

  // Title: Exchange Number
  doc.setFontSize(12);
  doc.setTextColor(0, 0, 0);
  doc.text(`Échange ${exchange.exchangeNumber || ''}`, margin, y);
  y += 6;

  // Subtitle: Original Order Reference
  if (exchange.orderNumber) {
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text(`Commande d'origine: ${exchange.orderNumber}`, margin, y);
    y += 5;
  }

  // Date
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  const dateStr = exchange.createdAt ? new Date(exchange.createdAt).toLocaleString('fr-FR') : new Date().toLocaleString('fr-FR');
  doc.text(`Date: ${dateStr}`, margin, y);
  y += 12;

  // Customer section
  doc.setFontSize(11);
  doc.setTextColor(0, 0, 0);
  doc.setFont(undefined, 'bold');
  doc.text('Client', margin, y);
  doc.setFont(undefined, 'normal');
  y += 6;

  doc.setFontSize(10);
  const customer = exchange.customer || {};
  const firstName = customer.firstName || customer.name || '';
  const lastName = customer.lastName || '';
  const fullName = `${firstName} ${lastName}`.trim() || 'Client';

  doc.text(fullName, margin, y);
  y += 5;
  if (customer.email) {
    doc.text(customer.email, margin, y);
    y += 5;
  }
  if (customer.phone) {
    doc.text(customer.phone, margin, y);
    y += 5;
  }
  const addressLines = doc.splitTextToSize(customer.address || customer.shippingAddress || '', 170);
  doc.text(addressLines, margin, y);
  y += addressLines.length * 5 + 8;

  // Exchange items section
  doc.setFontSize(11);
  doc.setFont(undefined, 'bold');
  doc.text('Articles de l\'échange', margin, y);
  doc.setFont(undefined, 'normal');
  y += 7;

  doc.setFontSize(9);
  const items = Array.isArray(exchange.items) ? exchange.items : [];
  items.forEach((item) => {
    const detailsStr = item.details || item.variantLabel ? ` (${item.details || item.variantLabel})` : '';
    const itemPrice = Number(item.price || item.unitPrice || 0);
    const line = `${item.name || item.productTitle}${detailsStr} x${item.quantity} — ${formatPrice(itemPrice * item.quantity)}`;
    const lines = doc.splitTextToSize(line, 170);
    doc.text(lines, margin, y);
    y += lines.length * 4 + 1;

    // Clearly display "ECHANGE" under each product price
    doc.setFontSize(8);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(141, 25, 28);
    doc.text('ECHANGE', margin, y);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(9);
    y += 5;

    if (y > 260) {
      doc.addPage();
      y = margin;
    }
  });

  y += 6;
  doc.setDrawColor(200, 200, 200);
  doc.line(margin, y, 190, y);
  y += 8;

  doc.setFontSize(10);
  doc.text(`Sous-total: ${formatPrice(exchange.subtotal)}`, margin, y);
  y += 5;
  if (Number(exchange.productAmountAdded) > 0) {
    doc.text(`Montant ajouté aux produits: ${formatPrice(exchange.productAmountAdded)}`, margin, y);
    y += 5;
  }
  if (Number(exchange.productRefundObligation) > 0) {
    doc.text(`Remboursement produit dû au client: ${formatPrice(exchange.productRefundObligation)}`, margin, y);
    y += 5;
  }
  const isSilkyPaid = exchange.paymentResponsibility === 'silky_paid';
  const deliveryLabel = isSilkyPaid
    ? `Livraison: ${formatPrice(exchange.deliveryFee)} (Prise en charge par Silky)`
    : `Livraison: ${formatPrice(exchange.deliveryFee)}`;
  doc.text(deliveryLabel, margin, y);
  y += 7;
  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.text(`Total (TTC): ${formatPrice(exchange.total)}`, margin, y);
  y += 7;
  doc.setTextColor(141, 25, 28);
  const exPayable = exchange.customerAmountToPay !== undefined
    ? exchange.customerAmountToPay
    : (exchange.finalCustomerPayableAmount !== undefined ? exchange.finalCustomerPayableAmount : exchange.total);
  doc.text(`Montant à payer: ${formatPrice(exPayable)}`, margin, y);
  doc.setTextColor(0, 0, 0);
  doc.setFont(undefined, 'normal');
}

export function renderRefundDocument(doc, refund) {
  const margin = 20;
  let y = margin;

  // Header - Brand
  doc.setFontSize(20);
  doc.setTextColor(141, 25, 28);
  doc.setFont(undefined, 'normal');
  doc.text('Silky', margin, y);
  y += 10;

  // Title: Refund Number
  doc.setFontSize(12);
  doc.setTextColor(0, 0, 0);
  doc.text(`Remboursement ${refund.refundNumber || ''}`, margin, y);
  y += 6;

  // Subtitle: Original Order Reference
  if (refund.orderNumber) {
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text(`Commande d'origine: ${refund.orderNumber}`, margin, y);
    y += 5;
  }

  // Date
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  const dateStr = refund.createdAt ? new Date(refund.createdAt).toLocaleString('fr-FR') : new Date().toLocaleString('fr-FR');
  doc.text(`Date: ${dateStr}`, margin, y);
  y += 12;

  // Customer section
  doc.setFontSize(11);
  doc.setTextColor(0, 0, 0);
  doc.setFont(undefined, 'bold');
  doc.text('Client', margin, y);
  doc.setFont(undefined, 'normal');
  y += 6;

  doc.setFontSize(10);
  const customer = refund.customer || {};
  const firstName = customer.firstName || customer.name || '';
  const lastName = customer.lastName || '';
  const fullName = `${firstName} ${lastName}`.trim() || 'Client';

  doc.text(fullName, margin, y);
  y += 5;
  if (customer.email) {
    doc.text(customer.email, margin, y);
    y += 5;
  }
  if (customer.phone) {
    doc.text(customer.phone, margin, y);
    y += 5;
  }
  const addressLines = doc.splitTextToSize(customer.address || customer.shippingAddress || '', 170);
  doc.text(addressLines, margin, y);
  y += addressLines.length * 5 + 8;

  // Refund items section
  doc.setFontSize(11);
  doc.setFont(undefined, 'bold');
  doc.text('Articles retournés', margin, y);
  doc.setFont(undefined, 'normal');
  y += 7;

  doc.setFontSize(9);
  const items = Array.isArray(refund.items) ? refund.items : [];
  items.forEach((item) => {
    const detailsStr = item.details || item.variantLabel ? ` (${item.details || item.variantLabel})` : '';
    const itemPrice = Number(item.price || item.unitPrice || 0);
    const line = `${item.name || item.productTitle}${detailsStr} x${item.quantity} — ${formatPrice(itemPrice * item.quantity)}`;
    const lines = doc.splitTextToSize(line, 170);
    doc.text(lines, margin, y);
    y += lines.length * 4 + 1;

    // Display "RETOUR" tag
    doc.setFontSize(8);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(141, 25, 28);
    doc.text('RETOUR', margin, y);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(9);
    y += 5;

    if (y > 260) {
      doc.addPage();
      y = margin;
    }
  });

  y += 6;
  doc.setDrawColor(200, 200, 200);
  doc.line(margin, y, 190, y);
  y += 8;

  doc.setFontSize(10);
  doc.text(`Montant des articles retournés: ${formatPrice(refund.refundAmount)}`, margin, y);
  y += 5;
  const isSilkyPaid = refund.paymentResponsibility === 'silky_paid' || Number(refund.deliveryFee) === 0;
  const deliveryLabel = isSilkyPaid
    ? `Frais de retour: ${formatPrice(refund.deliveryFee)} (Prise en charge par Silky)`
    : `Frais de retour payés par client: ${formatPrice(refund.deliveryFee)}`;
  doc.text(deliveryLabel, margin, y);
  y += 7;
  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.text(`Montant remboursé: ${formatPrice(refund.refundAmount)}`, margin, y);
  y += 7;
  doc.setTextColor(141, 25, 28);
  const refPayable = refund.customerAmountToPay !== undefined
    ? refund.customerAmountToPay
    : (refund.finalCustomerPayableAmount !== undefined ? refund.finalCustomerPayableAmount : 0);
  doc.text(`Montant à payer: ${formatPrice(refPayable)}`, margin, y);
  doc.setTextColor(0, 0, 0);
  doc.setFont(undefined, 'normal');
}

export function generateDocumentsPdf(documents) {
  if (!Array.isArray(documents) || documents.length === 0) return false;

  const doc = new jsPDF();

  documents.forEach((item, index) => {
    if (index > 0) {
      doc.addPage();
    }
    if (item.type === 'exchange') {
      renderExchangeDocument(doc, item.data || item);
    } else if (item.type === 'refund') {
      renderRefundDocument(doc, item.data || item);
    } else {
      renderOrderDocument(doc, item.data || item);
    }
  });

  let filename;
  if (documents.length === 1) {
    const single = documents[0];
    if (single.type === 'exchange') {
      const exData = single.data || single;
      filename = `${exData.exchangeNumber || 'Echange'}.pdf`;
    } else if (single.type === 'refund') {
      const refData = single.data || single;
      filename = `${refData.refundNumber || 'Remboursement'}.pdf`;
    } else {
      const orderData = single.data || single;
      filename = `${orderData.orderNumber || 'Commande'}.pdf`;
    }
  } else {
    const hasOrders = documents.some((d) => d.type === 'order' || (!d.type && !d.exchangeNumber && !d.refundNumber));
    const hasExchanges = documents.some((d) => d.type === 'exchange' || d.exchangeNumber);
    const hasRefunds = documents.some((d) => d.type === 'refund' || d.refundNumber);

    const typesCount = [hasOrders, hasExchanges, hasRefunds].filter(Boolean).length;
    if (typesCount === 1) {
      if (hasOrders) filename = `Commandes_Silky_${documents.length}_selectionnees.pdf`;
      else if (hasExchanges) filename = `Echanges_Silky_${documents.length}_selectionnes.pdf`;
      else if (hasRefunds) filename = `Remboursements_Silky_${documents.length}_selectionnes.pdf`;
    } else {
      filename = `Documents_Silky_${documents.length}_selectionnes.pdf`;
    }
  }

  doc.save(filename);
  return true;
}

export function generateOrdersPdf(orders) {
  if (!Array.isArray(orders) || orders.length === 0) return false;
  return generateDocumentsPdf(orders.map((order) => ({ type: 'order', data: order })));
}

export function generateOrderPdf(order) {
  return generateOrdersPdf([order]);
}

export function generateExchangePdf(exchange) {
  if (!exchange) return false;
  return generateDocumentsPdf([{ type: 'exchange', data: exchange }]);
}

export function generateRefundPdf(refund) {
  if (!refund) return false;
  return generateDocumentsPdf([{ type: 'refund', data: refund }]);
}

export function buildDocumentsToDownload(
  orders = [],
  selectedOrderIds = [],
  selectedExchangeIds = [],
  selectedRefundIds = [],
) {
  const documentsToDownload = [];

  orders.forEach((order) => {
    let currentDocType = 'order';
    let currentDocData = order;

    if (order.status === 'exchanged' && Array.isArray(order.exchanges) && order.exchanges.length > 0) {
      const sortedExchanges = [...order.exchanges].sort((a, b) => {
        const seqA = a.exchangeSequence || 0;
        const seqB = b.exchangeSequence || 0;
        if (seqA !== seqB) return seqB - seqA;
        return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
      });
      currentDocType = 'exchange';
      currentDocData = {
        ...sortedExchanges[0],
        orderNumber: sortedExchanges[0].orderNumber || order.orderNumber,
      };
    } else if (order.status === 'refunded' && Array.isArray(order.refunds) && order.refunds.length > 0) {
      const sortedRefunds = [...order.refunds].sort((a, b) => {
        return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
      });
      currentDocType = 'refund';
      currentDocData = {
        ...sortedRefunds[0],
        orderNumber: sortedRefunds[0].orderNumber || order.orderNumber,
      };
    }

    if (selectedOrderIds.includes(order.id)) {
      documentsToDownload.push({
        type: currentDocType,
        data: currentDocData,
      });
    }

    if (Array.isArray(order.exchanges)) {
      const sortedExchanges = [...order.exchanges].sort((a, b) => {
        const seqA = a.exchangeSequence || 0;
        const seqB = b.exchangeSequence || 0;
        if (seqA !== seqB) return seqA - seqB;
        return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
      });

      sortedExchanges.forEach((ex) => {
        if (selectedExchangeIds.includes(ex.id)) {
          const alreadyAdded =
            selectedOrderIds.includes(order.id) &&
            currentDocType === 'exchange' &&
            (currentDocData.id === ex.id || (ex.exchangeNumber && currentDocData.exchangeNumber === ex.exchangeNumber));
          if (!alreadyAdded) {
            documentsToDownload.push({
              type: 'exchange',
              data: {
                ...ex,
                orderNumber: ex.orderNumber || order.orderNumber,
              },
            });
          }
        }
      });
    }

    if (Array.isArray(order.refunds)) {
      const sortedRefunds = [...order.refunds].sort((a, b) => {
        return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
      });

      sortedRefunds.forEach((ref) => {
        if (selectedRefundIds.includes(ref.id)) {
          const alreadyAdded =
            selectedOrderIds.includes(order.id) &&
            currentDocType === 'refund' &&
            (currentDocData.id === ref.id || (ref.refundNumber && currentDocData.refundNumber === ref.refundNumber));
          if (!alreadyAdded) {
            documentsToDownload.push({
              type: 'refund',
              data: {
                ...ref,
                orderNumber: ref.orderNumber || order.orderNumber,
              },
            });
          }
        }
      });
    }
  });

  return documentsToDownload;
}


