import '../../styles/hero-editor.css';

export default function HeroTemplateSelector({
  selectedTemplate = 'option1',
  onSelectTemplate,
  onOpenEditor,
}) {
  return (
    <div className="hero_template_selector_container">
      <div className="hero_template_grid">
        {/* Option 1: Current Two-Image Hero */}
        <div
          className={`hero_template_card${selectedTemplate === 'option1' ? ' selected' : ''}`}
          onClick={() => onSelectTemplate('option1')}
        >
          <div className="hero_miniature_preview_box">
            <div className="miniature_split">
              <div className="miniature_text_overlay">
                <div className="miniature_title_bar" />
                <div className="miniature_sub_bar" />
              </div>
              <div className="miniature_split_left">
                <span className="miniature_btn" />
              </div>
              <div className="miniature_split_right">
                <span className="miniature_btn" />
              </div>
            </div>
          </div>
          <div className="hero_template_info">
            <h4 className="hero_template_name">Option 1 — Deux Images</h4>
            <p className="hero_template_desc">Disposition classique split avec 2 boutons</p>
          </div>
        </div>

        {/* Option 2: Single Image Hero */}
        <div
          className={`hero_template_card${selectedTemplate === 'option2' ? ' selected' : ''}`}
          onClick={() => onSelectTemplate('option2')}
        >
          <div className="hero_miniature_preview_box">
            <div className="miniature_single">
              <div className="miniature_single_content left">
                <div className="miniature_title_bar" style={{ width: '80px', margin: 0 }} />
                <div className="miniature_sub_bar" style={{ width: '50px', margin: 0 }} />
                <span className="miniature_btn" style={{ marginTop: '4px' }} />
              </div>
            </div>
          </div>
          <div className="hero_template_info">
            <h4 className="hero_template_name">Option 2 — Image Unique</h4>
            <p className="hero_template_desc">Image pleine largeur avec texte &amp; bouton</p>
          </div>
        </div>

        {/* Option 3: Carousel Hero */}
        <div
          className={`hero_template_card${selectedTemplate === 'option3' ? ' selected' : ''}`}
          onClick={() => onSelectTemplate('option3')}
        >
          <div className="hero_miniature_preview_box">
            <div className="miniature_carousel">
              <span className="miniature_carousel_arrow">❮</span>
              <div className="miniature_single_content left" style={{ flex: 1, padding: '0 8px' }}>
                <div className="miniature_title_bar" style={{ width: '70px', margin: 0 }} />
                <div className="miniature_sub_bar" style={{ width: '45px', margin: 0 }} />
                <span className="miniature_btn" style={{ marginTop: '4px' }} />
              </div>
              <span className="miniature_carousel_arrow">❯</span>
              <div className="miniature_carousel_dots">
                <span className="miniature_carousel_dot active" />
                <span className="miniature_carousel_dot" />
                <span className="miniature_carousel_dot" />
              </div>
            </div>
          </div>
          <div className="hero_template_info">
            <h4 className="hero_template_name">Option 3 — Carrousel Hero</h4>
            <p className="hero_template_desc">2 à 5 diapositives défilantes indépendantes</p>
          </div>
        </div>
      </div>

      {/* Centered Modifier Button directly under the selected template */}
      <div className="hero_template_modify_wrapper">
        <button
          type="button"
          className="hero_modifier_btn"
          onClick={onOpenEditor}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
          </svg>
          Modifier
        </button>
      </div>
    </div>
  );
}
