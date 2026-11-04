// A small stateful stand-in for the GOODEX API (parcels, tracking, claims), for browsing the admin without a real account.
// Same endpoints and answer shapes as server/scripts/test_goodex_claims.js. Listens on a loopback port, which is the only
// kind of base URL the real-provider gate (server/config/goodex.js) accepts in a test run.
import http from 'node:http';

export const CLAIM_TYPES = [
  { code: 'cod', label: 'Changement montant', value_type: 'montant', needs_value: true, hint: 'Nouveau montant COD à encaisser (en DT)', priorite: 'normale', message_required: false },
  { code: 'adresse', label: 'Changement adresse', value_type: 'texte', needs_value: true, hint: 'Nouvelle adresse complète', priorite: 'normale', message_required: false },
  { code: 'telephone', label: 'Changement téléphone', value_type: 'telephone', needs_value: true, hint: 'Nouveau numéro', priorite: 'normale', message_required: false },
  { code: 'colis_urgent', label: 'Colis urgent', needs_value: false, priorite: 'haute', message_required: false },
  { code: 'annuler', label: 'Annulation du colis', needs_value: false, priorite: 'haute', message_required: false },
];

function parseMultipart(raw) {
  const fields = {};
  const re = /name="([^"]+)"\r\n\r\n([\s\S]*?)\r\n--/g;
  let m;
  while ((m = re.exec(raw))) fields[m[1]] = m[2];
  return fields;
}

export async function startMockGoodex() {
  const state = { requests: [], claims: new Map(), nextClaim: 128, parcels: 0, statuses: new Map() };

  const handle = (rec, send) => {
    const { method, path, query, fields } = rec;
    const idMatch = /^\/api\/client\/tickets\/(\d+)$/.exec(path);
    if (method === 'POST' && path === '/api/v1/colis/create') {
      const n = ++state.parcels;
      const ean = `MOCK${n}${Date.now().toString().slice(-6)}`;
      return send(200, { id: 7000 + n, ean, user_id: 1, client: fields.client, cod: Number(fields.cod), last_statut: 12, created_at: '2026-11-04 10:30:00' });
    }
    if (method === 'GET' && path.startsWith('/api/v1/colis/etat/')) {
      const ean = decodeURIComponent(path.split('/').pop());
      return send(200, { ean, statut: state.statuses.get(ean) || 'En Transit', has_motif: 0, motif: '' });
    }
    if (method === 'GET' && path === '/api/v1/tickets/types') return send(200, { types: CLAIM_TYPES, statuts: ['nouveau', 'en_cours', 'resolu', 'rejete'] });
    if (method === 'POST' && path === '/api/client/tickets') {
      const def = CLAIM_TYPES.find((t) => t.code === fields.type);
      if (!def) return send(422, { message: 'Les informations saisies sont incomplètes', errors: { type: ['Type invalide'] } });
      const id = state.nextClaim++;
      const ticket = { id, reference: `TK-${String(id).padStart(6, '0')}`, colis_ean: fields.ean, type: def.code, type_label: def.label, valeur: fields.valeur ?? null, statut: 'nouveau', priorite: 'normale', is_open: true, reponse: null, created_at: '2026-11-04T09:12:44.000000Z' };
      state.claims.set(id, ticket);
      return send(201, { success: true, message: 'Votre réclamation a été envoyée.', ticket });
    }
    if (method === 'GET' && path === '/api/client/tickets/counts') {
      const all = [...state.claims.values()];
      const count = (s) => all.filter((t) => t.statut === s).length;
      return send(200, { nouveau: count('nouveau'), en_cours: count('en_cours'), resolu: count('resolu'), rejete: count('rejete'), ouverts: count('nouveau') + count('en_cours'), total: all.length });
    }
    if (method === 'GET' && path === '/api/client/tickets') {
      const items = [...state.claims.values()].sort((a, b) => b.id - a.id);
      const data = items.map(({ type, priorite, ...rest }) => rest);
      return send(200, { current_page: 1, data, total: items.length, per_page: 20, last_page: 1 });
    }
    if (method === 'GET' && idMatch) {
      const t = state.claims.get(Number(idMatch[1]));
      return t ? send(200, t) : send(404, { error: 'Réclamation introuvable' });
    }
    if (method === 'DELETE' && idMatch) {
      const t = state.claims.get(Number(idMatch[1]));
      if (!t) return send(404, { error: 'Réclamation introuvable' });
      if (t.statut !== 'nouveau') return send(422, { error: 'Cette réclamation est déjà prise en charge.' });
      state.claims.delete(t.id);
      return send(200, { success: true, message: 'Réclamation annulée' });
    }
    return send(404, {});
  };

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://mock');
      const rec = { method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), fields: parseMultipart(Buffer.concat(chunks).toString('utf8')) };
      state.requests.push({ method: rec.method, path: rec.path });
      handle(rec, (status, body) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    state,
    stop: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); }),
  };
}
