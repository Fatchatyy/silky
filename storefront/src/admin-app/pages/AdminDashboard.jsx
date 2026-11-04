import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminApi as api } from '../../admin/adminApi';
import { useAuth } from '../context/useAuth';
import { useTheme, DEFAULT_HERO_CONFIG } from '../context/ThemeContext';
import AdminOrders from './AdminOrders';
import AdminReviews from './AdminReviews';
import AdminProducts from './AdminProducts';
import AdminInventory from './AdminInventory';
import AdminAnalytics from './AdminAnalytics';
import AdminMessages from './AdminMessages';
import AdminDrafts from './AdminDrafts';
import AdminClaims from './AdminClaims';

import HeroTemplateSelector from '../components/hero/HeroTemplateSelector';
import HeroEditorModal from '../components/hero/HeroEditorModal';
import { useNotifications } from '../hooks/useNotifications';
import NotificationBell from '../components/NotificationBell';
import NotificationPanel from '../components/NotificationPanel';
import NotificationAllPanel from '../components/NotificationAllPanel';
import NotificationPopup from '../components/NotificationPopup';
import '../styles/hero-editor.css';

const NAV_SECTIONS = [
  {
    id: 'catalogue',
    title: 'Catalogue',
    icon: '/pictures/catalogue.png',
    items: [
      {
        id: 'products',
        label: 'Produits',
        icon: '/pictures/product.png',
        description: 'Gérez votre catalogue, vos produits, leurs variantes et leurs informations.',
      },
      {
        id: 'inventory',
        label: 'Inventaire',
        icon: '/pictures/inventory.png',
        description: 'Suivez les stocks, les variantes et les quantités disponibles.',
      },
    ],
  },
  {
    id: 'ventes',
    title: 'Ventes',
    icon: '/pictures/ventes.png',
    items: [
      {
        id: 'orders',
        label: 'Commandes',
        icon: '/pictures/orders.png',
        description: 'Gérez les commandes, leur statut, les livraisons, les échanges et les remboursements.',
      },
      {
        id: 'drafts',
        label: 'Brouillons',
        icon: '/pictures/draft.png',
        description: 'Gérez vos brouillons de commandes et convertissez-les en commandes réelles.',
      },
      {
        id: 'claims',
        label: 'Réclamations',
        icon: '/pictures/message.png',
        description: 'Consultez toutes les réclamations GOODEX, leur statut et les réponses du transporteur.',
      },
      {
        id: 'analytics',
        label: 'Statistiques',
        icon: '/pictures/stats.png',
        description: 'Analysez les ventes, les revenus, les performances et les indicateurs de votre activité.',
      },
    ],
  },
  {
    id: 'service_clients',
    title: 'Service clients',
    icon: '/pictures/serviceclient.png',
    items: [
      {
        id: 'reviews',
        label: 'Avis clients',
        icon: '/pictures/avisdash.png',
        description: 'Modérez les avis clients et gérez leur visibilité sur le site.',
      },
      {
        id: 'messages',
        label: 'Messages',
        icon: '/pictures/message.png',
        description: 'Consultez les messages clients et gérez les réponses et le suivi.',
      },
    ],
  },
  {
    id: 'parametres',
    title: 'Paramètres',
    icon: '/pictures/settings.png',
    items: [
      {
        id: 'theme',
        label: 'Thèmes',
        icon: '/pictures/theme.png',
        description: 'Personnalisez l’apparence et les paramètres visuels du site.',
      },
    ],
  },
];

const ALL_NAV_ITEMS = NAV_SECTIONS.flatMap((s) => s.items);

const DEFAULT_ANNOUNCEMENTS = [
  { text: 'Livraison sur toute la Tunisie!', bold: false, italic: false, underline: false },
  { text: 'Livraison rapide en 24/48 heures', bold: false, italic: false, underline: false },
  { text: 'Qualité garantie', bold: false, italic: false, underline: false },
  { text: 'Promotions speciales et Offres exclusives!', bold: false, italic: false, underline: false },
  { text: 'Service client disponible 24/7', bold: false, italic: false, underline: false },
];

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { theme, updateTheme } = useTheme();
  const [tab, setTab] = useState('analytics');
  const [adminRefreshKey, setAdminRefreshKey] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // Notifications
  const {
    notifications,
    unreadCount,
    newPopups,
    dismissPopup,
    markRead,
    markAllRead,
  } = useNotifications();

  const [panelOpen, setPanelOpen] = useState(false);
  const [allPanelOpen, setAllPanelOpen] = useState(false);

  // Target entity highlights
  const [highlightOrderId, setHighlightOrderId] = useState(null);
  const [highlightReviewId, setHighlightReviewId] = useState(null);
  const [highlightProductId, setHighlightProductId] = useState(null);
  const [highlightMessageId, setHighlightMessageId] = useState(null);

  const handleNavigateNotification = (n) => {
    if (!n) return;
    if (n.type === 'order') {
      setTab('orders');
      if (n.orderId) {
        setHighlightOrderId(n.orderId);
        setTimeout(() => setHighlightOrderId(null), 4000);
      }
    } else if (n.type === 'review') {
      setTab('reviews');
      if (n.reviewId) {
        setHighlightReviewId(n.reviewId);
        setTimeout(() => setHighlightReviewId(null), 4000);
      }
    } else if (n.type === 'product_review') {
      setTab('products');
      if (n.productId) {
        setHighlightProductId(n.productId);
        setTimeout(() => setHighlightProductId(null), 4000);
      }
      if (n.reviewId) {
        setHighlightReviewId(n.reviewId);
        setTimeout(() => setHighlightReviewId(null), 4000);
      }
    } else if (n.type === 'contact_message') {
      setTab('messages');
      if (n.contactMessageId) {
        setHighlightMessageId(n.contactMessageId);
        setTimeout(() => setHighlightMessageId(null), 4000);
      }
    }
  };

  const currentTab = ALL_NAV_ITEMS.find((t) => t.id === tab) || ALL_NAV_ITEMS[0];

  const handleAdminDataRefresh = () => setAdminRefreshKey((k) => k + 1);
  const [colors, setColors] = useState({
    primary: theme.primary,
    secondary: theme.secondary,
    heroLeftImage: theme.heroLeftImage !== undefined ? theme.heroLeftImage : '/pictures/femme_example.jpg',
    heroRightImage: theme.heroRightImage !== undefined ? theme.heroRightImage : '/pictures/enfant_example.jpg',
  });
  const [heroConfig, setHeroConfig] = useState(
    theme.heroConfig !== undefined ? theme.heroConfig : DEFAULT_HERO_CONFIG
  );
  const [heroEditorOpen, setHeroEditorOpen] = useState(false);
  const [announcements, setAnnouncements] = useState(
    theme.announcements !== undefined ? theme.announcements : DEFAULT_ANNOUNCEMENTS
  );
  const [announcementsHidden, setAnnouncementsHidden] = useState(
    Boolean(theme.announcementsHidden)
  );
  const [editingIndex, setEditingIndex] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setColors({
      primary: theme.primary,
      secondary: theme.secondary,
      heroLeftImage: theme.heroLeftImage !== undefined ? theme.heroLeftImage : '/pictures/femme_example.jpg',
      heroRightImage: theme.heroRightImage !== undefined ? theme.heroRightImage : '/pictures/enfant_example.jpg',
    });
    setHeroConfig(
      theme.heroConfig !== undefined ? theme.heroConfig : DEFAULT_HERO_CONFIG
    );
    setAnnouncements(
      theme.announcements !== undefined ? theme.announcements : DEFAULT_ANNOUNCEMENTS
    );
    setAnnouncementsHidden(Boolean(theme.announcementsHidden));
  }, [theme.primary, theme.secondary, theme.heroLeftImage, theme.heroRightImage, theme.announcements, theme.announcementsHidden, theme.heroConfig]);

  const handleLogout = async () => {
    try {
      await api.adminLogout();
    } catch {
      /* ignore */
    }
    logout();
    navigate('/login');
  };

  const handleSelectTemplate = (templateType) => {
    setHeroConfig((prev) => ({
      ...prev,
      templateType,
    }));
  };

  const handleSaveHeroConfig = async (savedHeroConfig) => {
    setHeroConfig(savedHeroConfig);
    setHeroEditorOpen(false);
    setSaving(true);
    setMessage('');
    try {
      await updateTheme({
        ...colors,
        announcements,
        announcementsHidden,
        heroConfig: savedHeroConfig,
      });
      setMessage('Bannière hero mise à jour avec succès.');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveTheme = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      await updateTheme({
        ...colors,
        announcements,
        announcementsHidden,
        heroConfig,
      });
      setMessage('Thème mis à jour avec succès.');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleAnnouncementsVisibility = async () => {
    const nextHidden = !announcementsHidden;
    setAnnouncementsHidden(nextHidden);
    try {
      await updateTheme({
        ...colors,
        announcements,
        announcementsHidden: nextHidden,
        heroConfig,
      });
      setMessage(nextHidden ? 'Barre d’annonces masquée.' : 'Barre d’annonces affichée.');
    } catch (err) {
      setMessage(err.message);
    }
  };

  const handleAddAnnouncement = () => {
    if (announcements.length >= 7) return;
    const newIdx = announcements.length;
    setAnnouncements((prev) => [
      ...prev,
      { text: '', bold: false, italic: false, underline: false },
    ]);
    setEditingIndex(newIdx);
  };

  const handleDeleteAnnouncement = (index) => {
    setAnnouncements((prev) => prev.filter((_, i) => i !== index));
    if (editingIndex === index) {
      setEditingIndex(null);
    } else if (editingIndex > index) {
      setEditingIndex(editingIndex - 1);
    }
  };

  const handleUpdateAnnouncementText = (index, text) => {
    setAnnouncements((prev) =>
      prev.map((item, i) => (i === index ? { ...item, text } : item))
    );
  };

  const handleToggleFormatting = (index, format) => {
    setAnnouncements((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, [format]: !item[format] } : item
      )
    );
  };

  const handleTabChange = (id) => {
    setTab(id);
    setSidebarOpen(false);
  };

  return (
    <div className="admin-dashboard">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="admin-sidebar-overlay"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside className={`admin-sidebar${sidebarOpen ? ' is-open' : ''}${collapsed ? ' is-collapsed' : ''}`}>
        <div className="admin-sidebar-brand">
          {/* The shop is a different part of the site (outside the admin router): a plain link, full page load. */}
          <a
            href="/"
            className="logo"
            onClick={() => window.scrollTo({ top: 0, left: 0, behavior: 'smooth' })}
            title="Silky - Retour à la boutique"
          >
            <img className="logo_img" src="/pictures/logo.png" alt="Silky Logo" />
          </a>
          <button
            type="button"
            className="admin-sidebar-brand-btn"
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? 'Agrandir le menu' : 'Réduire le menu'}
            aria-label={collapsed ? 'Agrandir le menu' : 'Réduire le menu'}
          >
            <img src="/pictures/admin.png" alt="" className="admin-brand-icon" />
            <span className="admin-brand-text">Administration</span>
          </button>
          <button
            type="button"
            className="admin-sidebar-close"
            onClick={() => setSidebarOpen(false)}
            aria-label="Fermer le menu"
          >
            ✕
          </button>
        </div>

        <nav className="admin-sidebar-nav">
          {NAV_SECTIONS.map((section) => (
            <div key={section.id} className="admin-sidebar-section">
              <div className="admin-sidebar-section-header" title={section.title}>
                <img src={section.icon} alt="" className="admin-sidebar-section-icon" />
                <span className="admin-sidebar-section-title">{section.title}</span>
              </div>
              <div className="admin-sidebar-section-items">
                {section.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`admin-sidebar-nav-item${tab === item.id ? ' active' : ''}`}
                    onClick={() => handleTabChange(item.id)}
                    title={item.label}
                  >
                    <img src={item.icon} alt="" className="admin-sidebar-nav-icon" />
                    <span className="admin-sidebar-nav-label">{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <button
          type="button"
          className="admin-sidebar-logout"
          onClick={handleLogout}
          title="Déconnexion"
        >
          <img src="/pictures/logout.png" alt="" className="admin-sidebar-logout-icon" />
          <span className="admin-sidebar-logout-text">Déconnexion</span>
        </button>
      </aside>

      <div className="admin-main">
        <header className="admin-header">
          <button
            type="button"
            className="admin-hamburger"
            onClick={() => setSidebarOpen(true)}
            aria-label="Ouvrir le menu"
          >
            <span /><span /><span />
          </button>
          <div className="admin-header-title-wrapper">
            <div className="admin-header-title-row">
              <span
                className="admin-header-icon"
                style={{
                  WebkitMaskImage: `url(${currentTab.icon})`,
                  maskImage: `url(${currentTab.icon})`,
                }}
                aria-hidden="true"
              />
              <h2>{currentTab.label}</h2>
            </div>
            <p className="admin-header-desc">{currentTab.description}</p>
          </div>
        </header>

        <div className="admin-content">
        {tab === 'analytics' && <AdminAnalytics refreshKey={adminRefreshKey} />}
        {tab === 'products' && (
          <AdminProducts
            highlightProductId={highlightProductId}
            highlightReviewId={highlightReviewId}
          />
        )}
        {tab === 'inventory' && <AdminInventory refreshKey={adminRefreshKey} />}
        {tab === 'theme' && (
          <section className="admin-panel">
            <h2>Thème du site</h2>
            <p>Modifiez les couleurs et les images hero. Les changements sont appliqués après enregistrement.</p>

            <form className="admin-theme-form" onSubmit={handleSaveTheme}>
              <div className="admin-color-field">
                <label htmlFor="primary">Couleur principale (accent)</label>
                <div className="admin-color-input-row">
                  <input
                    type="color"
                    id="primary"
                    value={colors.primary}
                    onChange={(e) => setColors((c) => ({ ...c, primary: e.target.value.toUpperCase() }))}
                  />
                  <input
                    type="text"
                    value={colors.primary}
                    onChange={(e) => setColors((c) => ({ ...c, primary: e.target.value }))}
                    pattern="^#[0-9A-Fa-f]{6}$"
                  />
                </div>
                <span className="admin-color-preview" style={{ backgroundColor: colors.primary }} />
              </div>

              <div className="admin-color-field">
                <label htmlFor="secondary">Couleur secondaire (fond clair)</label>
                <div className="admin-color-input-row">
                  <input
                    type="color"
                    id="secondary"
                    value={colors.secondary}
                    onChange={(e) => setColors((c) => ({ ...c, secondary: e.target.value.toUpperCase() }))}
                  />
                  <input
                    type="text"
                    value={colors.secondary}
                    onChange={(e) => setColors((c) => ({ ...c, secondary: e.target.value }))}
                    pattern="^#[0-9A-Fa-f]{6}$"
                  />
                </div>
                <span className="admin-color-preview" style={{ backgroundColor: colors.secondary }} />
              </div>

              <div className="admin-theme-preview">
                <div
                  className="admin-theme-preview-light"
                  style={{ backgroundColor: colors.secondary, color: colors.primary }}
                >
                  Aperçu zone claire
                </div>
                <button
                  type="button"
                  className="admin-theme-preview-btn"
                  style={{ backgroundColor: colors.primary }}
                >
                  Bouton accent
                </button>
              </div>

              <h3 className="admin-section-subtitle">Images Hero (Page d&apos;accueil)</h3>

              <HeroTemplateSelector
                selectedTemplate={heroConfig.templateType || 'option1'}
                onSelectTemplate={handleSelectTemplate}
                onOpenEditor={() => setHeroEditorOpen(true)}
              />

              {heroEditorOpen && (
                <HeroEditorModal
                  heroConfig={heroConfig}
                  onSave={handleSaveHeroConfig}
                  onCancel={() => setHeroEditorOpen(false)}
                />
              )}

              <h3 className="admin-section-subtitle">Barre d&apos;annonces (haut de page)</h3>
              <p style={{ fontSize: '0.85rem', color: '#666', marginBottom: '14px' }}>
                Personnalisez jusqu&apos;à 7 zones de texte affichées entre les drapeaux tunisiens. La suppression de toutes les annonces masque la barre.
              </p>

              <div className="admin-announcements-editor" style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    gap: '8px',
                    flexWrap: 'wrap',
                  }}
                >
                  <span style={{ fontSize: '0.875rem', color: '#475569' }}>
                    Statut de la barre :{' '}
                    <strong style={{ color: announcementsHidden ? '#dc2626' : '#16a34a' }}>
                      {announcementsHidden ? 'Masquée' : 'Visible'}
                    </strong>
                  </span>
                  <button
                    type="button"
                    className={`admin-btn sm ${announcementsHidden ? 'primary' : 'secondary'}`}
                    onClick={handleToggleAnnouncementsVisibility}
                  >
                    {announcementsHidden ? 'Afficher' : 'Masquer'}
                  </button>
                </div>

                {announcements.map((item, index) => {
                  const isEditing = editingIndex === index;
                  return (
                    <div
                      key={index}
                      className="admin-announcement-card"
                      style={{
                        background: '#fafafa',
                        border: '1px solid #e2e8f0',
                        borderRadius: '8px',
                        padding: '12px 16px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <img
                            src="/pictures/tnflag.jpg"
                            alt="Drapeau Tunisie"
                            style={{ width: '20px', height: '14px', objectFit: 'cover', borderRadius: '2px' }}
                          />
                          <strong style={{ fontSize: '0.9rem', color: '#333' }}>Zone de texte {index + 1}</strong>
                        </div>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                          <button
                            type="button"
                            className={`admin-btn sm ${isEditing ? 'primary' : 'secondary'}`}
                            onClick={() => setEditingIndex(isEditing ? null : index)}
                          >
                            Modifier
                          </button>
                          <button
                            type="button"
                            className="admin-btn danger sm"
                            onClick={() => handleDeleteAnnouncement(index)}
                          >
                            Supprimer
                          </button>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <input
                          type="text"
                          className="admin-announcement-input"
                          style={{
                            flex: 1,
                            minWidth: '220px',
                            padding: '8px 12px',
                            border: '1px solid #dcd0d0',
                            borderRadius: '6px',
                            fontSize: '0.9rem',
                            fontWeight: item.bold ? '700' : 'normal',
                            fontStyle: item.italic ? 'italic' : 'normal',
                            textDecoration: item.underline ? 'underline' : 'none',
                          }}
                          placeholder="Texte de l'annonce..."
                          value={item.text}
                          onChange={(e) => handleUpdateAnnouncementText(index, e.target.value)}
                        />

                        <div className="admin-announcement-formatting" style={{ display: 'flex', gap: '4px' }}>
                          <button
                            type="button"
                            className={`admin-btn sm ${item.bold ? 'primary' : 'secondary'}`}
                            style={{ padding: '6px 12px', minWidth: '34px', fontWeight: 'bold' }}
                            onClick={() => handleToggleFormatting(index, 'bold')}
                            title="Gras"
                            aria-label="Mettre en gras"
                          >
                            B
                          </button>
                          <button
                            type="button"
                            className={`admin-btn sm ${item.italic ? 'primary' : 'secondary'}`}
                            style={{ padding: '6px 12px', minWidth: '34px', fontStyle: 'italic', fontFamily: 'serif' }}
                            onClick={() => handleToggleFormatting(index, 'italic')}
                            title="Italique"
                            aria-label="Mettre en italique"
                          >
                            I
                          </button>
                          <button
                            type="button"
                            className={`admin-btn sm ${item.underline ? 'primary' : 'secondary'}`}
                            style={{ padding: '6px 12px', minWidth: '34px', textDecoration: 'underline' }}
                            onClick={() => handleToggleFormatting(index, 'underline')}
                            title="Souligné"
                            aria-label="Souligner"
                          >
                            U
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {announcements.length < 7 && (
                  <div>
                    <button
                      type="button"
                      className="admin-btn secondary"
                      onClick={handleAddAnnouncement}
                    >
                      + Annonce
                    </button>
                  </div>
                )}
              </div>

              {message && <p className="admin-message">{message}</p>}

              <button type="submit" className="admin-primary-btn" disabled={saving}>
                {saving ? 'Enregistrement...' : 'Enregistrer le thème'}
              </button>
            </form>
          </section>
        )}

        {tab === 'orders' && (
          <AdminOrders
            refreshKey={adminRefreshKey}
            onOrderCreated={handleAdminDataRefresh}
            highlightOrderId={highlightOrderId}
          />
        )}
        {tab === 'drafts' && (
          <AdminDrafts onOrderCreated={handleAdminDataRefresh} />
        )}
        {tab === 'claims' && (
          <AdminClaims
            onShowOrder={(orderId) => handleNavigateNotification({ type: 'order', orderId })}
          />
        )}
        {tab === 'reviews' && (
          <AdminReviews highlightReviewId={highlightReviewId} />
        )}
        {tab === 'messages' && (
          <AdminMessages highlightMessageId={highlightMessageId} />
        )}

        </div>

        {/* Floating Notification Center (Popups on top, Bell button underneath in lower-right of admin-main) */}
        <div className="admin-floating-notifications-area">
          <NotificationPopup
            popups={newPopups}
            onDismiss={dismissPopup}
            onClick={(p) => {
              markRead(p.id);
              handleNavigateNotification(p);
            }}
          />

          <NotificationPanel
            notifications={notifications}
            unreadCount={unreadCount}
            isOpen={panelOpen}
            onClose={() => setPanelOpen(false)}
            onMarkRead={markRead}
            onMarkAllRead={markAllRead}
            onViewAll={() => setAllPanelOpen(true)}
            onNavigate={handleNavigateNotification}
          />

          <NotificationBell
            unreadCount={unreadCount}
            isOpen={panelOpen}
            onClick={() => setPanelOpen((prev) => !prev)}
          />
        </div>

        <NotificationAllPanel
          isOpen={allPanelOpen}
          onClose={() => setAllPanelOpen(false)}
          onMarkRead={markRead}
          onMarkAllRead={markAllRead}
          onNavigate={handleNavigateNotification}
        />
      </div>
    </div>
  );
}
