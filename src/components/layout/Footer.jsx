import { Link } from '../../i18n/router';
import { useT } from '../../i18n/useT';

export default function Footer() {
  const { t } = useT();
  const handleNavClick = (targetPath) => {
    const [, hash] = (targetPath || '').split('#');
    if (hash) {
      const element = document.getElementById(hash);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } else {
      window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
    }
  };

  return (
    <footer className="site_footer">
      <div className="footer_tagline_container">
        <p className="script_tagline">{t('footer.tagline')}</p>
        <p className="tagline_text">
          {t('footer.text1')}
        </p>
        <p className="tagline_text">
          {t('footer.text2')}
        </p>
      </div>

      <hr className="footer_divider" />

      <div className="footer_main_container">
        <div className="footer_brand_col">
          <Link
            to="/"
            className="footer_logo_link"
            title={t('footer.backToTop')}
            onClick={() => handleNavClick('/')}
          >
            <img src="/pictures/logo.png" alt="Silky Logo" className="footer_logo_img" />
          </Link>

          <div className="social_links_wrapper">
            <div className="social_icons">
              <a href="https://www.instagram.com/silky.tn/" className="social_icon_link">
                <img src="/pictures/instagram.png" alt="Instagram" />
              </a>
              <a href="https://www.tiktok.com/@silky4042" className="social_icon_link">
                <img src="/pictures/tiktok.png" alt="TikTok" />
              </a>
              <a href="https://www.facebook.com/profile.php?id=61560630851600" className="social_icon_link">
                <img src="/pictures/facebook.png" alt="Facebook" />
              </a>
              <a href="mailto:silky26tn@gmail.com" className="social_icon_link">
                <img src="/pictures/gmail.png" alt="Email" />
              </a>
            </div>
            <span className="follow_us_text">{t('footer.followUs')}</span>
          </div>
        </div>

        <div className="footer_nav_cols">
          <div className="footer_col">
            <h4>SILKY</h4>
            <ul>
              <li><Link to="/" onClick={() => handleNavClick('/')}>{t('nav.home')}</Link></li>
              <li><Link to="/collection/femme" onClick={() => handleNavClick('/collection/femme')}>{t('nav.women')}</Link></li>
              <li><Link to="/collection/enfant" onClick={() => handleNavClick('/collection/enfant')}>{t('nav.kids')}</Link></li>
            </ul>
          </div>

          <div className="footer_col">
            <h4>{t('footer.about')}</h4>
            <ul>
              <li><Link to="/about" onClick={() => handleNavClick('/about')}>{t('footer.aboutUs')}</Link></li>
            </ul>
          </div>

          <div className="footer_col">
            <h4>{t('footer.help')}</h4>
            <ul>
              <li><Link to="/service-client" onClick={() => handleNavClick('/service-client')}>{t('footer.customerService')}</Link></li>
              <li><Link to="/contact" onClick={() => handleNavClick('/contact')}>{t('footer.contactUs')}</Link></li>
              <li><Link to="/livraison-retours#livraison" onClick={() => handleNavClick('/livraison-retours#livraison')}>{t('footer.deliveryInfo')}</Link></li>
              <li><Link to="/livraison-retours#retours" onClick={() => handleNavClick('/livraison-retours#retours')}>{t('footer.returnsPolicy')}</Link></li>
              <li><Link to="/faq" onClick={() => handleNavClick('/faq')}>{t('footer.faq')}</Link></li>
            </ul>
          </div>
        </div>
      </div>

      <div className="footer_copyright">
        <p>
          &copy; 2026 Silky
          {' · by '}
          <a
            href="https://github.com/HamedSallloua"
            target="_blank"
            rel="noopener noreferrer"
            className="footer_author_link"
          >
            Hamed
          </a>
        </p>
      </div>
    </footer>
  );
}
