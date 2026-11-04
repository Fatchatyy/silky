import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import { formatPrice } from '../../../shared/formatPrice';
import AdminAnalyticsCharts from '../../components/admin/AdminAnalyticsCharts';

export default function AdminAnalytics({ refreshKey = 0 }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Independent Granularity & Period selections
  const [lineGranularity, setLineGranularity] = useState('daily');
  const [piePeriod, setPiePeriod] = useState('year');

  const loadAnalytics = useCallback((isInitial = false) => {
    if (isInitial) setLoading(true);
    setError('');
    api
      .getAdminAnalytics({ granularity: lineGranularity, piePeriod, limit: 52 })
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => {
        if (isInitial) setLoading(false);
      });
  }, [lineGranularity, piePeriod]);

  useEffect(() => {
    loadAnalytics(!data);
  }, [loadAnalytics, refreshKey]);

  if (loading) return <p className="admin-loading">Chargement des statistiques...</p>;
  if (error) return <p className="admin-error">{error}</p>;
  if (!data) return null;

  const {
    kpi,
    delivery,
    revenueTrend,
    topProducts,
    pieDelivery,
    pieTopProducts,
  } = data;

  const deliveryData = delivery || {
    customerDeliveryRevenue: kpi.customerDeliveryRevenue || 0,
    deliveryCompanyExpense: kpi.deliveryCompanyExpense || 0,
    deliveryMargin: kpi.deliveryMargin || 0,
    normalDeliveries: { count: 0, revenue: 0, expense: 0, margin: 0 },
    customerPaidExchanges: { count: 0, revenue: 0, expense: 0, margin: 0 },
    silkyPaidExchanges: { count: 0, revenue: 0, expense: 0, margin: 0 },
    refunds: { count: 0, revenue: 0, expense: 0, margin: 0 },
    customerPaidRefunds: { count: 0, revenue: 0, expense: 0, margin: 0 },
    silkyPaidRefunds: { count: 0, revenue: 0, expense: 0, margin: 0 },
    cancellations: { count: 0, revenue: 0, expense: 0, margin: 0 },
  };

  const netRevenue = kpi.netRevenue !== undefined
    ? Number(kpi.netRevenue)
    : Number(kpi.totalRevenue || 0) - Number(deliveryData.deliveryCompanyExpense || 0);

  const averageOrderValueNet = kpi.averageOrderValueNet !== undefined
    ? Number(kpi.averageOrderValueNet)
    : (kpi.netAverageOrderValue !== undefined
      ? Number(kpi.netAverageOrderValue)
      : (Number(kpi.totalOrders || 0) > 0 ? netRevenue / Number(kpi.totalOrders || 0) : 0));

  const customerPaidRefunds = deliveryData.customerPaidRefunds || deliveryData.refunds || deliveryData.remboursements || { count: 0, revenue: 0, expense: 0, margin: 0 };
  const silkyPaidRefunds = deliveryData.silkyPaidRefunds || { count: 0, revenue: 0, expense: 0, margin: 0 };

  return (
    <section className="admin-panel admin-analytics">
      <div className="admin-panel-header">
        <div>
          <h2>Statistiques</h2>
          <p>Vue d&apos;ensemble des ventes et performances</p>
        </div>
        <div className="admin-analytics-controls">
          <button type="button" className="admin-secondary-btn" onClick={() => loadAnalytics(false)}>
            Actualiser
          </button>
        </div>
      </div>

      <div className="admin-kpi-grid">
        <article className="admin-kpi-card">
          <span className="admin-kpi-label">Revenu total</span>
          <strong className="admin-kpi-value">{formatPrice(kpi.totalRevenue)}</strong>
          <div className="admin-kpi-secondary">
            <span className="admin-kpi-secondary-label">Revenu net</span>
            <span className="admin-kpi-secondary-value">{formatPrice(netRevenue)}</span>
          </div>
        </article>
        <article className="admin-kpi-card">
          <span className="admin-kpi-label">Commandes</span>
          <strong className="admin-kpi-value">{kpi.totalOrders}</strong>
        </article>
        <article className="admin-kpi-card">
          <span className="admin-kpi-label">Panier moyen</span>
          <strong className="admin-kpi-value">{formatPrice(kpi.averageOrderValue)}</strong>
          <div className="admin-kpi-secondary">
            <span className="admin-kpi-secondary-label">Panier moyen net</span>
            <span className="admin-kpi-secondary-value">{formatPrice(averageOrderValueNet)}</span>
          </div>
        </article>
        <article className="admin-kpi-card">
          <span className="admin-kpi-label">Clients</span>
          <strong className="admin-kpi-value">{kpi.totalCustomers}</strong>
        </article>
        <article className="admin-kpi-card">
          <span className="admin-kpi-label">Montant payé total</span>
          <strong className="admin-kpi-value">{formatPrice(kpi.montantPayeTotal)}</strong>
          <div className="admin-kpi-secondary">
            <span className="admin-kpi-secondary-label">Montant payé net</span>
            <span className="admin-kpi-secondary-value">{formatPrice(kpi.montantPayeNet)}</span>
          </div>
        </article>
      </div>

      <div className="admin-delivery-section">
        <h3 className="admin-delivery-section-title">Économie de Livraison</h3>
        <div className="admin-delivery-kpi-grid">
          <article className="admin-kpi-card admin-delivery-kpi-card">
            <span className="admin-kpi-label">Revenu livraison (Clients)</span>
            <strong className="admin-kpi-value">{formatPrice(deliveryData.customerDeliveryRevenue)}</strong>
          </article>
          <article className="admin-kpi-card admin-delivery-kpi-card">
            <span className="admin-kpi-label">Dépense transporteur</span>
            <strong className="admin-kpi-value">{formatPrice(deliveryData.deliveryCompanyExpense)}</strong>
          </article>
          <article className={`admin-kpi-card admin-delivery-kpi-card ${deliveryData.deliveryMargin >= 0 ? 'margin-positive' : 'margin-negative'}`}>
            <span className="admin-kpi-label">Marge nette livraison</span>
            <strong className="admin-kpi-value">
              {deliveryData.deliveryMargin > 0 ? '+' : ''}{formatPrice(deliveryData.deliveryMargin)}
            </strong>
          </article>
        </div>

        <div className="admin-analytics-table-wrap" style={{ marginBottom: '28px' }}>
          <table className="stock-table admin-analytics-table">
            <thead>
              <tr>
                <th>Opération de livraison</th>
                <th>Nombre</th>
                <th>Revenu client</th>
                <th>Coût transporteur</th>
                <th>Marge Silky</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Livraisons normales</strong></td>
                <td>{deliveryData.normalDeliveries.count}</td>
                <td>{formatPrice(deliveryData.normalDeliveries.revenue)}</td>
                <td>{formatPrice(deliveryData.normalDeliveries.expense)}</td>
                <td>
                  <span className={deliveryData.normalDeliveries.margin >= 0 ? 'margin-badge positive' : 'margin-badge negative'}>
                    {deliveryData.normalDeliveries.margin > 0 ? '+' : ''}{formatPrice(deliveryData.normalDeliveries.margin)}
                  </span>
                </td>
              </tr>
              <tr>
                <td><strong>Échanges (Payés client)</strong></td>
                <td>{deliveryData.customerPaidExchanges.count}</td>
                <td>{formatPrice(deliveryData.customerPaidExchanges.revenue)}</td>
                <td>{formatPrice(deliveryData.customerPaidExchanges.expense)}</td>
                <td>
                  <span className={deliveryData.customerPaidExchanges.margin >= 0 ? 'margin-badge positive' : 'margin-badge negative'}>
                    {deliveryData.customerPaidExchanges.margin > 0 ? '+' : ''}{formatPrice(deliveryData.customerPaidExchanges.margin)}
                  </span>
                </td>
              </tr>
              <tr>
                <td><strong>Échanges payés (Pris en charge Silky)</strong></td>
                <td>{deliveryData.silkyPaidExchanges.count}</td>
                <td>{formatPrice(deliveryData.silkyPaidExchanges.revenue)}</td>
                <td>{formatPrice(deliveryData.silkyPaidExchanges.expense)}</td>
                <td>
                  <span className={deliveryData.silkyPaidExchanges.margin >= 0 ? 'margin-badge positive' : 'margin-badge negative'}>
                    {deliveryData.silkyPaidExchanges.margin > 0 ? '+' : ''}{formatPrice(deliveryData.silkyPaidExchanges.margin)}
                  </span>
                </td>
              </tr>
              <tr>
                <td><strong>Remboursements (Payés client)</strong></td>
                <td>{customerPaidRefunds.count}</td>
                <td>{formatPrice(customerPaidRefunds.revenue)}</td>
                <td>{formatPrice(customerPaidRefunds.expense)}</td>
                <td>
                  <span className={customerPaidRefunds.margin >= 0 ? 'margin-badge positive' : 'margin-badge negative'}>
                    {customerPaidRefunds.margin > 0 ? '+' : ''}{formatPrice(customerPaidRefunds.margin)}
                  </span>
                </td>
              </tr>
              <tr>
                <td><strong>Remboursements gratuits (Pris en charge Silky)</strong></td>
                <td>{silkyPaidRefunds.count}</td>
                <td>{formatPrice(silkyPaidRefunds.revenue)}</td>
                <td>{formatPrice(silkyPaidRefunds.expense)}</td>
                <td>
                  <span className={silkyPaidRefunds.margin >= 0 ? 'margin-badge positive' : 'margin-badge negative'}>
                    {silkyPaidRefunds.margin > 0 ? '+' : ''}{formatPrice(silkyPaidRefunds.margin)}
                  </span>
                </td>
              </tr>
              <tr>
                <td><strong>Annulations</strong></td>
                <td>{deliveryData.cancellations.count}</td>
                <td>{formatPrice(0)}</td>
                <td>{formatPrice(0)}</td>
                <td>
                  <span className="margin-badge neutral">{formatPrice(0)}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="admin-analytics-grid">
        <div className="admin-analytics-block">
          <h3>Produits les plus vendus</h3>
          {topProducts.length === 0 ? (
            <p className="admin-empty">Aucune vente enregistrée.</p>
          ) : (
            <div className="admin-analytics-table-wrap">
              <table className="stock-table admin-analytics-table">
                <thead>
                  <tr>
                    <th>Produit</th>
                    <th>Quantité</th>
                    <th>Revenu</th>
                  </tr>
                </thead>
                <tbody>
                  {topProducts.map((row) => (
                    <tr key={row.productTitle}>
                      <td className="admin-analytics-product-cell">{row.productTitle}</td>
                      <td>{row.quantitySold}</td>
                      <td>{formatPrice(row.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Interactive Line & Pie Chart Area replacing the old admin-analytics-trend */}
      <AdminAnalyticsCharts
        trend={revenueTrend}
        deliveryData={pieDelivery || deliveryData}
        topProducts={pieTopProducts || topProducts}
        lineGranularity={lineGranularity}
        piePeriod={piePeriod}
        onLineGranularityChange={setLineGranularity}
        onPiePeriodChange={setPiePeriod}
      />
    </section>
  );
}

