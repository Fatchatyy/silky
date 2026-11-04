import { useState, useMemo } from 'react';
import { formatPrice } from '../../../shared/formatPrice';

const LINE_METRIC_CONFIG = {
  revenue: {
    key: 'revenue',
    label: 'Revenu total',
    color: '#8D191C',
    gradientId: 'gradientTotalRevenue',
    description: 'Revenu total brut incluant frais de livraison',
  },
  netRevenue: {
    key: 'netRevenue',
    label: 'Revenu net',
    color: '#2563EB',
    gradientId: 'gradientNetRevenue',
    description: 'Revenu après déduction des frais transporteur',
  },
  deliveryMargin: {
    key: 'deliveryMargin',
    label: 'Marge nette livraison',
    color: '#059669',
    gradientId: 'gradientDeliveryMargin',
    description: 'Marge nette dégagée sur les livraisons',
  },
};

const PIE_PALETTE_PRODUCTS = [
  '#8D191C',
  '#2563EB',
  '#059669',
  '#D97706',
  '#7C3AED',
  '#DB2777',
  '#0891B2',
  '#475569',
  '#E11D48',
  '#0D9488',
];

const DELIVERY_COLORS = {
  normalDeliveries: '#2563EB',
  customerPaidExchanges: '#059669',
  silkyPaidExchanges: '#8D191C',
  customerPaidRefunds: '#D97706',
  silkyPaidRefunds: '#DC2626',
  cancellations: '#94A3B8',
};

function formatPeriodDate(dateStr, granularity) {
  if (!dateStr) return '';
  try {
    if (granularity === 'yearly' || granularity === 'year') {
      return dateStr;
    }
    if (granularity === 'monthly' || granularity === 'month') {
      const [year, month] = dateStr.split('-');
      if (!month) return dateStr;
      const date = new Date(Number(year), Number(month) - 1, 1);
      return date.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
    }
    if (granularity === 'weekly' || granularity === 'week') {
      const [year, month, day] = dateStr.split('-');
      if (!day) return dateStr;
      const date = new Date(Number(year), Number(month) - 1, Number(day));
      return `Sem. du ${date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`;
    }
    const [year, month, day] = dateStr.split('-');
    if (!day) return dateStr;
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  } catch {
    return dateStr;
  }
}

// -----------------------------------------------------------------------------
// Interactive SVG Line Chart
// -----------------------------------------------------------------------------
function LineChart({
  trend = [],
  metric = 'revenue',
  granularity = 'daily',
  mode = 'values',
  onMetricChange,
  onGranularityChange,
  onModeChange,
}) {
  const [hoveredIndex, setHoveredIndex] = useState(null);

  const activeConfig = LINE_METRIC_CONFIG[metric] || LINE_METRIC_CONFIG.revenue;

  // Process data points
  const points = useMemo(() => {
    if (!Array.isArray(trend) || trend.length === 0) return [];
    return trend.map((item, index) => {
      const rawVal = Number(item[metric] !== undefined ? item[metric] : item.revenue || 0);
      const totalRev = Number(item.revenue || 0);
      const netRev = Number(item.netRevenue !== undefined ? item.netRevenue : totalRev);
      const delMargin = Number(item.deliveryMargin || 0);
      const orderCount = Number(item.orderCount || 0);
      const dateLabel = formatPeriodDate(item.date || item.period, granularity);

      return {
        index,
        rawDate: item.date || item.period,
        dateLabel,
        rawVal,
        totalRev,
        netRev,
        delMargin,
        orderCount,
      };
    });
  }, [trend, metric, granularity]);

  // Calculate sum and percentages
  const { totalSum, maxVal, minVal, dataWithPercentages } = useMemo(() => {
    if (points.length === 0) {
      return { totalSum: 0, maxVal: 10, minVal: 0, dataWithPercentages: [] };
    }

    const sum = points.reduce((acc, p) => acc + Math.abs(p.rawVal), 0);
    const sumSigned = points.reduce((acc, p) => acc + p.rawVal, 0);

    const withPct = points.map((p) => {
      const pct = sum > 0 ? (p.rawVal / sum) * 100 : 0;
      return {
        ...p,
        percentage: pct,
        displayVal: mode === 'percentages' ? pct : p.rawVal,
      };
    });

    const displayVals = withPct.map((p) => p.displayVal);
    let max = Math.max(...displayVals, 0);
    let min = Math.min(...displayVals, 0);

    if (max === min) {
      max = max > 0 ? max * 1.2 : 10;
      min = min < 0 ? min * 1.2 : 0;
    } else {
      const padding = (max - min) * 0.15;
      max += padding;
      if (min < 0) min -= padding;
    }

    return {
      totalSum: sumSigned,
      maxVal: max,
      minVal: min,
      dataWithPercentages: withPct,
    };
  }, [points, mode]);

  // SVG Coordinates mapping
  const width = 800;
  const height = 300;
  const padding = { top: 30, right: 35, bottom: 50, left: 70 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const getY = (val) => {
    if (maxVal === minVal) return padding.top + chartH / 2;
    const ratio = (val - minVal) / (maxVal - minVal);
    return padding.top + chartH - ratio * chartH;
  };

  const getX = (idx, total) => {
    if (total <= 1) return padding.left + chartW / 2;
    return padding.left + (idx / (total - 1)) * chartW;
  };

  const zeroY = getY(0);

  // Line path and area path
  const linePath = useMemo(() => {
    if (dataWithPercentages.length === 0) return '';
    return dataWithPercentages
      .map((p, i) => {
        const x = getX(i, dataWithPercentages.length);
        const y = getY(p.displayVal);
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
  }, [dataWithPercentages, maxVal, minVal]);

  const areaPath = useMemo(() => {
    if (dataWithPercentages.length === 0) return '';
    const firstX = getX(0, dataWithPercentages.length);
    const lastX = getX(dataWithPercentages.length - 1, dataWithPercentages.length);
    const clampedZeroY = Math.min(Math.max(zeroY, padding.top), padding.top + chartH);

    const linePoints = dataWithPercentages
      .map((p, i) => {
        const x = getX(i, dataWithPercentages.length);
        const y = getY(p.displayVal);
        return `L ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');

    return `M ${firstX.toFixed(1)} ${clampedZeroY.toFixed(1)} ${linePoints} L ${lastX.toFixed(1)} ${clampedZeroY.toFixed(1)} Z`;
  }, [dataWithPercentages, zeroY, maxVal, minVal]);

  // Y-axis ticks (4 ticks)
  const yTicks = useMemo(() => {
    const ticks = [];
    const count = 4;
    for (let i = 0; i <= count; i++) {
      const val = minVal + (i / count) * (maxVal - minVal);
      const y = getY(val);
      let label = '';
      if (mode === 'percentages') {
        label = `${val.toFixed(1)}%`;
      } else {
        label = Math.abs(val) >= 1000 ? `${(val / 1000).toFixed(1)}k DT` : `${Math.round(val)} DT`;
      }
      ticks.push({ val, y, label });
    }
    return ticks;
  }, [minVal, maxVal, mode]);

  // Average and Peak stats
  const avgVal = points.length > 0 ? totalSum / points.length : 0;
  const peakPoint = useMemo(() => {
    if (points.length === 0) return null;
    return points.reduce((best, cur) => (cur.rawVal > best.rawVal ? cur : best), points[0]);
  }, [points]);

  const hoveredPoint = hoveredIndex !== null ? dataWithPercentages[hoveredIndex] : null;

  return (
    <div className="admin-analytics-card admin-line-chart-block">
      {/* Top Controls Header */}
      <div className="admin-chart-header">
        <div className="admin-chart-title-group">
          <div className="admin-chart-badge" style={{ backgroundColor: `${activeConfig.color}15`, color: activeConfig.color }}>
            <span className="admin-chart-dot" style={{ backgroundColor: activeConfig.color }} />
            {activeConfig.label}
          </div>
          <h3 className="admin-chart-title">Évolution chronologique</h3>
        </div>

        <div className="admin-chart-controls">
          {/* Metric Selector */}
          <div className="admin-control-group">
            <label className="admin-control-label" htmlFor="line-metric-select">Métrique</label>
            <select
              id="line-metric-select"
              value={metric}
              onChange={(e) => onMetricChange(e.target.value)}
              className="admin-select-styled"
            >
              <option value="revenue">Revenu total</option>
              <option value="netRevenue">Revenu net</option>
              <option value="deliveryMargin">Marge nette livraison</option>
            </select>
          </div>

          {/* Time Period Selector */}
          <div className="admin-control-group">
            <label className="admin-control-label" htmlFor="line-period-select">Période</label>
            <select
              id="line-period-select"
              value={granularity}
              onChange={(e) => onGranularityChange(e.target.value)}
              className="admin-select-styled"
            >
              <option value="daily">Jour</option>
              <option value="weekly">Semaine</option>
              <option value="monthly">Mois</option>
              <option value="yearly">Année</option>
            </select>
          </div>

          {/* Display Mode: Valeurs vs Pourcentages */}
          <div className="admin-control-group">
            <label className="admin-control-label">Affichage</label>
            <div className="admin-segmented-control" role="group" aria-label="Mode d'affichage du graphique linéaire">
              <button
                type="button"
                className={`admin-segment-btn ${mode === 'values' ? 'active' : ''}`}
                onClick={() => onModeChange('values')}
              >
                Valeurs
              </button>
              <button
                type="button"
                className={`admin-segment-btn ${mode === 'percentages' ? 'active' : ''}`}
                onClick={() => onModeChange('percentages')}
              >
                Pourcentages
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Mini KPI summary bar */}
      <div className="admin-chart-summary-row">
        <div className="admin-summary-chip">
          <span className="admin-summary-chip-label">Total période</span>
          <strong className="admin-summary-chip-val" style={{ color: activeConfig.color }}>
            {formatPrice(totalSum)}
          </strong>
        </div>
        <div className="admin-summary-chip">
          <span className="admin-summary-chip-label">Moyenne / point</span>
          <strong className="admin-summary-chip-val">{formatPrice(avgVal)}</strong>
        </div>
        {peakPoint && (
          <div className="admin-summary-chip">
            <span className="admin-summary-chip-label">Pic ({peakPoint.dateLabel})</span>
            <strong className="admin-summary-chip-val">{formatPrice(peakPoint.rawVal)}</strong>
          </div>
        )}
        {mode === 'percentages' && (
          <div className="admin-mode-badge-info">
            <span>ℹ️ Mode Pourcentages : Part relative de chaque point sur la période</span>
          </div>
        )}
      </div>

      {/* Graph Area */}
      {dataWithPercentages.length === 0 ? (
        <div className="admin-chart-empty-state">
          <p>Aucune donnée de tendance enregistrée pour cette période.</p>
        </div>
      ) : (
        <div className="admin-svg-container">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="admin-line-svg"
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              <linearGradient id={activeConfig.gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor={activeConfig.color} stopOpacity="0.28" />
                <stop offset="100%" stopColor={activeConfig.color} stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* Background Grid Lines */}
            {yTicks.map((tick, i) => (
              <g key={i} className="admin-grid-line-group">
                <line
                  x1={padding.left}
                  y1={tick.y}
                  x2={width - padding.right}
                  y2={tick.y}
                  stroke="#e8edf2"
                  strokeDasharray={tick.val === 0 ? '0' : '4 4'}
                  strokeWidth={tick.val === 0 ? 1.5 : 1}
                />
                <text
                  x={padding.left - 10}
                  y={tick.y + 4}
                  textAnchor="end"
                  className="admin-axis-tick-label"
                >
                  {tick.label}
                </text>
              </g>
            ))}

            {/* Zero Axis baseline if in range */}
            {minVal < 0 && maxVal > 0 && (
              <line
                x1={padding.left}
                y1={zeroY}
                x2={width - padding.right}
                y2={zeroY}
                stroke="#cbd5e1"
                strokeWidth={1.5}
              />
            )}

            {/* Gradient Filled Area */}
            <path d={areaPath} fill={`url(#${activeConfig.gradientId})`} />

            {/* Main Trend Line */}
            <path
              d={linePath}
              fill="none"
              stroke={activeConfig.color}
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Hover Vertical Guide Line */}
            {hoveredIndex !== null && dataWithPercentages[hoveredIndex] && (
              <line
                x1={getX(hoveredIndex, dataWithPercentages.length)}
                y1={padding.top}
                x2={getX(hoveredIndex, dataWithPercentages.length)}
                y2={padding.top + chartH}
                stroke={activeConfig.color}
                strokeDasharray="3 3"
                strokeWidth={1.5}
                opacity={0.6}
              />
            )}

            {/* Data Points and Interaction Circles */}
            {dataWithPercentages.map((point, idx) => {
              const cx = getX(idx, dataWithPercentages.length);
              const cy = getY(point.displayVal);
              const isHovered = hoveredIndex === idx;

              // Display date labels on X axis with reasonable frequency
              const showLabel =
                dataWithPercentages.length <= 12 ||
                idx === 0 ||
                idx === dataWithPercentages.length - 1 ||
                idx % Math.ceil(dataWithPercentages.length / 8) === 0;

              return (
                <g key={idx}>
                  {/* Point Circle */}
                  <circle
                    cx={cx}
                    cy={cy}
                    r={isHovered ? 6 : dataWithPercentages.length > 30 ? 2.5 : 4}
                    fill="#fff"
                    stroke={activeConfig.color}
                    strokeWidth={isHovered ? 3 : 2}
                    className="admin-data-point"
                  />

                  {/* X Axis Label */}
                  {showLabel && (
                    <text
                      x={cx}
                      y={padding.top + chartH + 20}
                      textAnchor="middle"
                      className="admin-x-axis-label"
                    >
                      {point.dateLabel}
                    </text>
                  )}

                  {/* Hit Target for Hover */}
                  <rect
                    x={cx - chartW / (dataWithPercentages.length * 2 || 1)}
                    y={padding.top}
                    width={chartW / (dataWithPercentages.length || 1)}
                    height={chartH + 30}
                    fill="transparent"
                    onMouseEnter={() => setHoveredIndex(idx)}
                    onMouseLeave={() => setHoveredIndex(null)}
                    style={{ cursor: 'pointer' }}
                  />
                </g>
              );
            })}
          </svg>

          {/* Interactive Floating Tooltip */}
          {hoveredPoint && (
            <div
              className="admin-chart-tooltip"
              style={{
                left: `${(getX(hoveredPoint.index, dataWithPercentages.length) / width) * 100}%`,
                top: `${(getY(hoveredPoint.displayVal) / height) * 100}%`,
              }}
            >
              <div className="admin-tooltip-header">
                <strong>{hoveredPoint.dateLabel}</strong>
                <span className="admin-tooltip-badge">{hoveredPoint.orderCount} cmd</span>
              </div>
              <div className="admin-tooltip-body">
                <div className="admin-tooltip-row active-metric" style={{ color: activeConfig.color }}>
                  <span>{activeConfig.label} :</span>
                  <strong>
                    {formatPrice(hoveredPoint.rawVal)} ({hoveredPoint.percentage.toFixed(1)}%)
                  </strong>
                </div>
                {metric !== 'revenue' && (
                  <div className="admin-tooltip-row secondary">
                    <span>Revenu total :</span>
                    <span>{formatPrice(hoveredPoint.totalRev)}</span>
                  </div>
                )}
                {metric !== 'netRevenue' && (
                  <div className="admin-tooltip-row secondary">
                    <span>Revenu net :</span>
                    <span>{formatPrice(hoveredPoint.netRev)}</span>
                  </div>
                )}
                {metric !== 'deliveryMargin' && (
                  <div className="admin-tooltip-row secondary">
                    <span>Marge livraison :</span>
                    <span>{formatPrice(hoveredPoint.delMargin)}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Interactive SVG Pie / Donut Chart
// -----------------------------------------------------------------------------
function PieChart({
  type = 'delivery',
  period = 'year',
  mode = 'values',
  deliveryData,
  topProducts = [],
  onTypeChange,
  onPeriodChange,
  onModeChange,
}) {
  const [hoveredIndex, setHoveredIndex] = useState(null);

  // Compute segments based on chart type
  const segments = useMemo(() => {
    if (type === 'delivery') {
      const d = deliveryData || {};
      const normalCount = Number(d.normalDeliveries?.count || 0);
      const cpExchanges = Number(d.customerPaidExchanges?.count || 0);
      const spExchanges = Number(d.silkyPaidExchanges?.count || 0);
      const cpRefunds = Number(d.customerPaidRefunds?.count || d.refunds?.count || 0);
      const spRefunds = Number(d.silkyPaidRefunds?.count || 0);
      const cancelCount = Number(d.cancellations?.count || 0);

      const items = [
        { label: 'Livraisons normales', value: normalCount, color: DELIVERY_COLORS.normalDeliveries, unit: 'livraisons' },
        { label: 'Échanges payés client', value: cpExchanges, color: DELIVERY_COLORS.customerPaidExchanges, unit: 'échanges' },
        { label: 'Échanges payés Silky', value: spExchanges, color: DELIVERY_COLORS.silkyPaidExchanges, unit: 'échanges' },
        { label: 'Remboursements payés client', value: cpRefunds, color: DELIVERY_COLORS.customerPaidRefunds, unit: 'retours' },
        { label: 'Remboursements payés Silky', value: spRefunds, color: DELIVERY_COLORS.silkyPaidRefunds, unit: 'retours' },
        { label: 'Annulations', value: cancelCount, color: DELIVERY_COLORS.cancellations, unit: 'annulations' },
      ];
      return items.filter((item) => item.value > 0);
    }

    if (type === 'topProducts') {
      const items = (topProducts || []).map((prod, idx) => ({
        label: prod.productTitle || prod.title || 'Produit',
        value: Number(prod.quantitySold || prod.unitsSold || 0),
        revenue: Number(prod.revenue || 0),
        color: PIE_PALETTE_PRODUCTS[idx % PIE_PALETTE_PRODUCTS.length],
        unit: 'unités',
      }));
      return items.filter((item) => item.value > 0);
    }

    return [];
  }, [type, deliveryData, topProducts]);

  const totalSum = useMemo(() => {
    return segments.reduce((sum, s) => sum + s.value, 0);
  }, [segments]);

  // Compute angles for donut slices
  const slices = useMemo(() => {
    if (totalSum === 0) return [];
    let currentAngle = -Math.PI / 2; // Start from top 12 o'clock

    return segments.map((item, idx) => {
      const fraction = item.value / totalSum;
      const angle = fraction * 2 * Math.PI;
      const startAngle = currentAngle;
      const endAngle = currentAngle + angle;
      currentAngle = endAngle;

      const percentage = fraction * 100;

      return {
        ...item,
        index: idx,
        percentage,
        startAngle,
        endAngle,
        fraction,
      };
    });
  }, [segments, totalSum]);

  // SVG Geometry
  const size = 320;
  const cx = size / 2;
  const cy = size / 2;
  const rOut = 125;
  const rIn = 72;

  function createDonutArc(startAngle, endAngle, isHighlighted) {
    const actualROut = isHighlighted ? rOut + 6 : rOut;
    const actualRIn = isHighlighted ? rIn - 2 : rIn;

    // Full 360 circle handling
    if (endAngle - startAngle >= 2 * Math.PI - 0.001) {
      return `
        M ${cx} ${cy - actualROut}
        A ${actualROut} ${actualROut} 0 1 1 ${cx - 0.01} ${cy - actualROut}
        L ${cx - 0.01} ${cy - actualRIn}
        A ${actualRIn} ${actualRIn} 0 1 0 ${cx} ${cy - actualRIn}
        Z
      `;
    }

    const x1 = cx + actualROut * Math.cos(startAngle);
    const y1 = cy + actualROut * Math.sin(startAngle);
    const x2 = cx + actualROut * Math.cos(endAngle);
    const y2 = cy + actualROut * Math.sin(endAngle);

    const x3 = cx + actualRIn * Math.cos(endAngle);
    const y3 = cy + actualRIn * Math.sin(endAngle);
    const x4 = cx + actualRIn * Math.cos(startAngle);
    const y4 = cy + actualRIn * Math.sin(startAngle);

    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;

    return `
      M ${x1.toFixed(2)} ${y1.toFixed(2)}
      A ${actualROut} ${actualROut} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}
      L ${x3.toFixed(2)} ${y3.toFixed(2)}
      A ${actualRIn} ${actualRIn} 0 ${largeArc} 0 ${x4.toFixed(2)} ${y4.toFixed(2)}
      Z
    `;
  }

  const activeSlice = hoveredIndex !== null ? slices[hoveredIndex] : null;

  return (
    <div className="admin-analytics-card admin-pie-chart-block">
      {/* Top Controls Header */}
      <div className="admin-chart-header">
        <div className="admin-chart-title-group">
          <span className="admin-chart-badge admin-pie-badge">
            <span className="admin-chart-dot" style={{ backgroundColor: '#8D191C' }} />
            Répartition
          </span>
          <h3 className="admin-chart-title">Répartition & Comparaison</h3>
        </div>

        <div className="admin-chart-controls">
          {/* Chart Type Selector */}
          <div className="admin-control-group">
            <label className="admin-control-label" htmlFor="pie-type-select">Type de vue</label>
            <select
              id="pie-type-select"
              value={type}
              onChange={(e) => onTypeChange(e.target.value)}
              className="admin-select-styled"
            >
              <option value="delivery">Livraisons / Commandes</option>
              <option value="topProducts">Produits les plus vendus</option>
            </select>
          </div>

          {/* Time Period Selector */}
          <div className="admin-control-group">
            <label className="admin-control-label" htmlFor="pie-period-select">Période</label>
            <select
              id="pie-period-select"
              value={period}
              onChange={(e) => onPeriodChange(e.target.value)}
              className="admin-select-styled"
            >
              <option value="day">Jour</option>
              <option value="week">Semaine</option>
              <option value="month">Mois</option>
              <option value="year">Année</option>
            </select>
          </div>

          {/* Display Mode: Valeurs vs Pourcentages */}
          <div className="admin-control-group">
            <label className="admin-control-label">Affichage</label>
            <div className="admin-segmented-control" role="group" aria-label="Mode d'affichage du graphique circulaire">
              <button
                type="button"
                className={`admin-segment-btn ${mode === 'values' ? 'active' : ''}`}
                onClick={() => onModeChange('values')}
              >
                Valeurs
              </button>
              <button
                type="button"
                className={`admin-segment-btn ${mode === 'percentages' ? 'active' : ''}`}
                onClick={() => onModeChange('percentages')}
              >
                Pourcentages
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Mode Banner Description */}
      <div className="admin-chart-mode-info">
        {mode === 'values' ? (
          <span>Mode actif : <strong>Valeurs absolues</strong> (quantités et volumes réels)</span>
        ) : (
          <span>Mode actif : <strong>Pourcentages</strong> (contribution relative de chaque part au total)</span>
        )}
      </div>

      {/* Donut & Legend Container */}
      {slices.length === 0 ? (
        <div className="admin-chart-empty-state">
          <p>Aucune donnée enregistrée pour cette période ({period}).</p>
        </div>
      ) : (
        <div className="admin-donut-layout">
          {/* SVG Donut */}
          <div className="admin-donut-svg-wrap">
            <svg viewBox={`0 0 ${size} ${size}`} className="admin-donut-svg">
              {slices.map((slice) => {
                const isHovered = hoveredIndex === slice.index;
                const pathData = createDonutArc(slice.startAngle, slice.endAngle, isHovered);

                return (
                  <path
                    key={slice.index}
                    d={pathData}
                    fill={slice.color}
                    opacity={hoveredIndex === null || isHovered ? 1 : 0.45}
                    stroke="#fff"
                    strokeWidth={2}
                    className="admin-donut-slice"
                    onMouseEnter={() => setHoveredIndex(slice.index)}
                    onMouseLeave={() => setHoveredIndex(null)}
                    style={{ transition: 'opacity 0.2s ease, transform 0.2s ease', cursor: 'pointer' }}
                  />
                );
              })}

              {/* Center Donut Hole Labels */}
              <circle cx={cx} cy={cy} r={rIn - 4} fill="#fff" />
              <text x={cx} y={cy - 10} textAnchor="middle" className="admin-donut-center-title">
                {activeSlice ? activeSlice.label.slice(0, 18) : 'Total'}
              </text>
              <text x={cx} y={cy + 16} textAnchor="middle" className="admin-donut-center-value">
                {activeSlice
                  ? mode === 'percentages'
                    ? `${activeSlice.percentage.toFixed(1)}%`
                    : `${activeSlice.value}`
                  : mode === 'percentages'
                  ? '100%'
                  : totalSum}
              </text>
              <text x={cx} y={cy + 32} textAnchor="middle" className="admin-donut-center-sub">
                {activeSlice ? `${activeSlice.value} ${activeSlice.unit}` : 'opérations'}
              </text>
            </svg>
          </div>

          {/* Interactive Legend */}
          <div className="admin-donut-legend">
            <div className="admin-legend-list">
              {slices.map((slice) => {
                const isHovered = hoveredIndex === slice.index;
                return (
                  <div
                    key={slice.index}
                    className={`admin-legend-item ${isHovered ? 'hovered' : ''}`}
                    onMouseEnter={() => setHoveredIndex(slice.index)}
                    onMouseLeave={() => setHoveredIndex(null)}
                  >
                    <div className="admin-legend-left">
                      <span className="admin-legend-dot" style={{ backgroundColor: slice.color }} />
                      <span className="admin-legend-label">{slice.label}</span>
                    </div>
                    <div className="admin-legend-values">
                      <strong className="admin-legend-main-val">
                        {mode === 'percentages'
                          ? `${slice.percentage.toFixed(1)}%`
                          : `${slice.value} ${slice.unit}`}
                      </strong>
                      <span className="admin-legend-sub-val">
                        {mode === 'percentages'
                          ? `(${slice.value} ${slice.unit})`
                          : `(${slice.percentage.toFixed(1)}%)`}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Unified Exported Component Container
// -----------------------------------------------------------------------------
export default function AdminAnalyticsCharts({
  trend = [],
  deliveryData,
  topProducts = [],
  lineGranularity = 'daily',
  piePeriod = 'year',
  onLineGranularityChange,
  onPiePeriodChange,
}) {
  // Independent Line chart states
  const [lineMetric, setLineMetric] = useState('revenue');
  const [lineMode, setLineMode] = useState('values');

  // Independent Pie chart states
  const [pieType, setPieType] = useState('delivery');
  const [pieMode, setPieMode] = useState('values');

  return (
    <div className="admin-analytics-interactive-section">
      {/* 1. Line Graph Section */}
      <LineChart
        trend={trend}
        metric={lineMetric}
        granularity={lineGranularity}
        mode={lineMode}
        onMetricChange={setLineMetric}
        onGranularityChange={onLineGranularityChange}
        onModeChange={setLineMode}
      />

      {/* 2. Pie / Donut Chart Section */}
      <PieChart
        type={pieType}
        period={piePeriod}
        mode={pieMode}
        deliveryData={deliveryData}
        topProducts={topProducts}
        onTypeChange={setPieType}
        onPeriodChange={onPiePeriodChange}
        onModeChange={setPieMode}
      />
    </div>
  );
}
