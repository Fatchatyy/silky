/**
 * Side-effect import for legacy scripts that are not about GOODEX but confirm orders and then
 * deliver / exchange / refund them. Their fixtures (no governorate, invalid phone) can never
 * produce a GOODEX parcel, and those actions are refused while the parcel is not created, so
 * the guard is switched off for the run. Real GOODEX calls stay blocked by the live-call gate.
 *
 * Usage: import './helpers/parcel_guard_off.js';  (right after `import '../config/env.js'`)
 */
import { disableParcelGuardForTests } from '../../services/delivery.service.js';

disableParcelGuardForTests();
