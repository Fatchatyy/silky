import * as publishService from '../services/publish.service.js';
import { sendError } from '../utils/errors.js';

export async function status(_req, res) {
  try {
    res.json(await publishService.getStatus());
  } catch (err) {
    sendError(res, err);
  }
}

export async function publish(_req, res) {
  try {
    res.json(await publishService.publishNow());
  } catch (err) {
    sendError(res, err);
  }
}
