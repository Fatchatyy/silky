// The images uploaded while the home hero is edited (see admin/uploadSession.js). The hero editor modal discards them when it
// is closed without saving, and the dashboard discards them after the hero is saved (the ones the hero uses are kept).
import { createUploadSession } from '../../../admin/uploadSession';

export const heroUploads = createUploadSession();
