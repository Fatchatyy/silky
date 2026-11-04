import * as claimsService from '../services/claims.service.js';

/** Like sendError, plus the provider's per-field validation messages when there are any. */
function sendClaimError(res, err) {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({
    error: err.message || 'Internal server error',
    ...(err.errors ? { errors: err.errors } : {}),
    ...(err.outcome ? { outcome: err.outcome } : {}),
  });
}

const handler = (fn, successStatus = 200) => async (req, res) => {
  try {
    res.status(successStatus).json(await fn(req));
  } catch (err) {
    sendClaimError(res, err);
  }
};

export const getTypes = handler((req) => claimsService.getClaimTypes({ force: req.query.refresh === '1' }));
export const getCounts = handler(() => claimsService.getClaimCounts());
export const listRemote = handler((req) => claimsService.listRemoteClaims(req.query));
export const listForOrder = handler((req) => claimsService.listOrderClaims(req.params.id));
export const syncForOrder = handler((req) => claimsService.syncOrderClaims(req.params.id));
export const refresh = handler((req) => claimsService.refreshClaim(req.params.claimId));
export const cancel = handler((req) => claimsService.cancelClaim(req.params.claimId));

// 201 only when a new claim exists; already_sent answers 200 and is never shown as a creation.
export async function open(req, res) {
  try {
    const result = await claimsService.openClaim(req.params.id, req.body || {});
    res.status(result.result === 'created' ? 201 : 200).json(result);
  } catch (err) {
    sendClaimError(res, err);
  }
}
