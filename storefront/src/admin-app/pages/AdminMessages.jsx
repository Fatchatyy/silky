import { useEffect, useState } from 'react';
import { adminApi as api } from '../../admin/adminApi';

export default function AdminMessages({ highlightMessageId = null }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [activeHighlightId, setActiveHighlightId] = useState(null);

  // Reply Composer Modal state
  const [replyingMessage, setReplyingMessage] = useState(null);
  const [replySubject, setReplySubject] = useState('');
  const [replyBody, setReplyBody] = useState('');
  const [replySending, setReplySending] = useState(false);
  const [replyError, setReplyError] = useState('');
  const [replySuccess, setReplySuccess] = useState('');

  const loadMessages = async (isInitial = false) => {
    if (isInitial) setLoading(true);
    setError('');
    try {
      const data = await api.getContactMessages();
      setMessages(data || []);
    } catch (err) {
      setError(err.message || 'Impossible de charger les messages.');
    } finally {
      if (isInitial) setLoading(false);
    }
  };

  useEffect(() => {
    loadMessages(true);
  }, []);

  useEffect(() => {
    if (highlightMessageId && messages.length > 0) {
      setSearchQuery('');
      setActiveHighlightId(highlightMessageId);
      const timer = setTimeout(() => {
        const el = document.getElementById(`msg-${highlightMessageId}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);

      const clearTimer = setTimeout(() => {
        setActiveHighlightId(null);
      }, 3500);

      return () => {
        clearTimeout(timer);
        clearTimeout(clearTimer);
      };
    }
  }, [highlightMessageId, messages]);

  const openReplyModal = (msg) => {
    if (!msg) return;
    setReplyingMessage(msg);
    setReplySubject('Re: Demande de contact');
    setReplyBody('');
    setReplyError('');
    setReplySuccess('');
  };

  const closeReplyModal = () => {
    if (replySending) return;
    setReplyingMessage(null);
    setReplySubject('');
    setReplyBody('');
    setReplyError('');
    setReplySuccess('');
  };

  const handleSendReply = async (e) => {
    e.preventDefault();
    if (!replySubject.trim() || !replyBody.trim()) {
      setReplyError('Veuillez remplir le sujet et le message.');
      return;
    }

    setReplySending(true);
    setReplyError('');
    setReplySuccess('');

    try {
      const res = await api.sendContactReply(replyingMessage.id, {
        subject: replySubject.trim(),
        message: replyBody.trim(),
      });
      // Update local state only after backend confirms email was sent and status persisted
      if (res?.contactMessage) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === res.contactMessage.id
              ? { ...m, status: res.contactMessage.status, repliedAt: res.contactMessage.repliedAt }
              : m
          )
        );
      }
      setReplySuccess(res?.message || 'Réponse envoyée avec succès.');
      setTimeout(() => {
        closeReplyModal();
      }, 1400);
    } catch (err) {
      setReplyError(err.message || "Erreur lors de l'envoi de la réponse.");
    } finally {
      setReplySending(false);
    }
  };

  const filteredMessages = messages.filter((msg) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    const fullName = `${msg.firstName || ''} ${msg.lastName || ''}`.toLowerCase();
    const email = (msg.email || '').toLowerCase();
    const body = (msg.message || '').toLowerCase();
    return fullName.includes(q) || email.includes(q) || body.includes(q);
  });

  return (
    <div className="admin-messages-layout">
      <section className="admin-panel">
        <div className="admin-messages-header">
          <div>
            <h2>Messages de contact ({messages.length})</h2>
            <p>Consultez les messages reçus depuis le formulaire de contact et répondez par e-mail.</p>
          </div>
          <button
            type="button"
            className="admin-secondary-btn"
            onClick={loadMessages}
            disabled={loading}
          >
            Actualiser
          </button>
        </div>

        <div className="admin-search-bar">
          <input
            type="text"
            placeholder="Rechercher par nom, e-mail ou contenu du message..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="admin-search-input"
          />
          {searchQuery && (
            <button
              type="button"
              className="admin-search-clear-btn"
              onClick={() => setSearchQuery('')}
              title="Effacer la recherche"
              aria-label="Effacer la recherche"
            >
              ✕
            </button>
          )}
        </div>

        {error && <p className="admin-error">{error}</p>}

        {loading ? (
          <p className="admin-loading">Chargement des messages...</p>
        ) : filteredMessages.length === 0 ? (
          <p className="admin-empty">
            {searchQuery ? 'Aucun message correspondant à votre recherche.' : 'Aucun message de contact reçu pour le moment.'}
          </p>
        ) : (
          <div className="admin-messages-list">
            {filteredMessages.map((msg) => (
              <article
                key={msg.id}
                id={`msg-${msg.id}`}
                className={`admin-message-card ${activeHighlightId === msg.id ? 'notification-highlight' : ''}`}
              >
                <div className="admin-message-header-row">
                  <div className="admin-message-sender-info">
                    <strong className="admin-message-author">
                      {msg.firstName} {msg.lastName}
                    </strong>
                    <span className="admin-message-email">{msg.email}</span>
                  </div>
                  <div className="admin-message-header-meta">
                    <span
                      className={`admin-msg-status-badge ${msg.status === 'resolved' ? 'resolved' : 'pending'}`}
                    >
                      {msg.status === 'resolved' ? 'Résolu' : 'En attente'}
                    </span>
                    <span className="admin-message-date">
                      {new Date(msg.createdAt).toLocaleString('fr-FR', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                </div>

                <div className="admin-message-preview">
                  <p>{msg.message}</p>
                </div>

                <div className="admin-message-actions">
                  <button
                    type="button"
                    className="admin-secondary-btn admin-view-msg-btn"
                    onClick={() => setSelectedMessage(msg)}
                  >
                    Voir le message
                  </button>
                  <button
                    type="button"
                    className="admin-primary-btn admin-reply-btn"
                    onClick={() => openReplyModal(msg)}
                  >
                    Répondre
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Message detail modal */}
      {selectedMessage && (
        <div
          className="admin-modal-overlay"
          onClick={() => setSelectedMessage(null)}
          aria-hidden="true"
        >
          <div
            className="admin-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-msg-title"
          >
            <div className="admin-modal-header">
              <h2 id="modal-msg-title">Message de {selectedMessage.firstName} {selectedMessage.lastName}</h2>
              <button
                type="button"
                className="admin-modal-close"
                onClick={() => setSelectedMessage(null)}
                aria-label="Fermer"
              >
                ✕
              </button>
            </div>

            <div className="admin-message-modal-body">
              <div className="admin-message-detail-meta">
                <div className="admin-meta-field">
                  <label>Expéditeur :</label>
                  <span>{selectedMessage.firstName} {selectedMessage.lastName}</span>
                </div>
                <div className="admin-meta-field">
                  <label>E-mail :</label>
                  <span>{selectedMessage.email}</span>
                </div>
                <div className="admin-meta-field">
                  <label>Date de réception :</label>
                  <span>
                    {new Date(selectedMessage.createdAt).toLocaleString('fr-FR', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                </div>
                <div className="admin-meta-field">
                  <label>Statut :</label>
                  <span
                    className={`admin-msg-status-badge ${selectedMessage.status === 'resolved' ? 'resolved' : 'pending'}`}
                  >
                    {selectedMessage.status === 'resolved' ? 'Résolu' : 'En attente'}
                  </span>
                </div>
                {selectedMessage.status === 'resolved' && selectedMessage.repliedAt && (
                  <div className="admin-meta-field">
                    <label>Répondu le :</label>
                    <span>
                      {new Date(selectedMessage.repliedAt).toLocaleString('fr-FR', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                )}
              </div>

              <div className="admin-message-content-box">
                <label>Message :</label>
                <div className="admin-message-full-text">
                  {selectedMessage.message}
                </div>
              </div>

              <div className="admin-message-modal-actions">
                <button
                  type="button"
                  className="admin-secondary-btn"
                  onClick={() => setSelectedMessage(null)}
                >
                  Fermer
                </button>
                <button
                  type="button"
                  className="admin-primary-btn admin-reply-btn"
                  onClick={() => {
                    const msg = selectedMessage;
                    setSelectedMessage(null);
                    openReplyModal(msg);
                  }}
                >
                  Répondre
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reply Composer Modal */}
      {replyingMessage && (
        <div
          className="admin-modal-overlay"
          onClick={closeReplyModal}
          aria-hidden="true"
        >
          <div
            className="admin-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-reply-title"
          >
            <div className="admin-modal-header">
              <h2 id="modal-reply-title">
                Répondre à {replyingMessage.firstName} {replyingMessage.lastName}
              </h2>
              <button
                type="button"
                className="admin-modal-close"
                onClick={closeReplyModal}
                disabled={replySending}
                aria-label="Fermer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSendReply} className="admin-message-modal-body">
              {replyError && <p className="admin-error" style={{ margin: 0 }}>{replyError}</p>}
              {replySuccess && <p className="admin-success" style={{ margin: 0 }}>{replySuccess}</p>}

              <div className="admin-meta-field" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label htmlFor="reply-to-email" style={{ fontWeight: 600, color: '#475569' }}>
                  Destinataire :
                </label>
                <input
                  id="reply-to-email"
                  type="text"
                  value={replyingMessage.email}
                  readOnly
                  disabled
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #e2e8f0',
                    backgroundColor: '#f1f5f9',
                    color: '#64748b',
                    fontSize: '0.9rem',
                    cursor: 'not-allowed',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div className="admin-meta-field" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label htmlFor="reply-subject" style={{ fontWeight: 600, color: '#475569' }}>
                  Objet * :
                </label>
                <input
                  id="reply-subject"
                  type="text"
                  value={replySubject}
                  onChange={(e) => setReplySubject(e.target.value)}
                  disabled={replySending}
                  required
                  placeholder="Objet du message..."
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    fontSize: '0.9rem',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div className="admin-message-content-box">
                <label htmlFor="reply-body" style={{ fontWeight: 600, color: '#475569' }}>
                  Message * :
                </label>
                <textarea
                  id="reply-body"
                  rows={8}
                  value={replyBody}
                  onChange={(e) => setReplyBody(e.target.value)}
                  disabled={replySending}
                  required
                  placeholder="Rédigez votre réponse ici..."
                  style={{
                    width: '100%',
                    padding: '12px',
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    fontSize: '0.9rem',
                    lineHeight: 1.6,
                    resize: 'vertical',
                    fontFamily: 'inherit',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div className="admin-message-modal-actions">
                <button
                  type="button"
                  className="admin-secondary-btn"
                  onClick={closeReplyModal}
                  disabled={replySending}
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="admin-primary-btn"
                  disabled={replySending || !replySubject.trim() || !replyBody.trim()}
                >
                  {replySending ? 'Envoi en cours...' : 'Envoyer la réponse'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
