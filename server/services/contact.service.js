import { contactRepository } from '../repositories/contact.repository.js';
import { AppError } from '../utils/errors.js';
import { sendContactReplyEmail } from './email.service.js';
import * as notificationService from './notification.service.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_MESSAGE_LENGTH = 5000;

export async function submitContactMessage({ userId = null, guestSessionId = null, firstName, lastName, email, message }) {
  const trimmedFirst = (firstName || '').trim();
  if (!trimmedFirst) {
    throw new AppError('Le prénom est obligatoire.', 400);
  }
  if (trimmedFirst.length < 3) {
    throw new AppError('Le prénom doit contenir au moins 3 lettres.', 400);
  }
  if (trimmedFirst.length > 35) {
    throw new AppError('Le prénom ne doit pas dépasser 35 lettres.', 400);
  }

  const trimmedLast = (lastName || '').trim();
  if (!trimmedLast) {
    throw new AppError('Le nom est obligatoire.', 400);
  }
  if (trimmedLast.length < 3) {
    throw new AppError('Le nom doit contenir au moins 3 lettres.', 400);
  }
  if (trimmedLast.length > 35) {
    throw new AppError('Le nom ne doit pas dépasser 35 lettres.', 400);
  }

  const trimmedEmail = (email || '').trim();
  if (!trimmedEmail) {
    throw new AppError("L'adresse e-mail est obligatoire.", 400);
  }
  if (!EMAIL_REGEX.test(trimmedEmail)) {
    throw new AppError('Veuillez entrer une adresse e-mail valide.', 400);
  }

  const trimmedMessage = (message || '').trim();
  if (!trimmedMessage) {
    throw new AppError('Le message est obligatoire.', 400);
  }
  if (trimmedMessage.length > MAX_MESSAGE_LENGTH) {
    throw new AppError(`Le message ne doit pas dépasser ${MAX_MESSAGE_LENGTH} caractères.`, 400);
  }

  const result = await contactRepository.createMessage({
    userId,
    guestSessionId,
    firstName: trimmedFirst,
    lastName: trimmedLast,
    email: trimmedEmail,
    message: trimmedMessage,
  });

  if (result) {
    await notificationService.createContactMessageNotification(result);
  }

  return result;
}

export async function getAllContactMessages() {
  return contactRepository.getAllMessages();
}

export async function getContactMessageById(id) {
  const msg = await contactRepository.getMessageById(id);
  if (!msg) {
    throw new AppError('Message introuvable.', 404);
  }
  return msg;
}

export async function replyToContactMessage(id, { subject, message }) {
  const msg = await contactRepository.getMessageById(id);
  if (!msg) {
    throw new AppError('Message introuvable.', 404);
  }

  const recipientEmail = (msg.email || '').trim();
  if (!recipientEmail) {
    throw new AppError("Ce message ne contient pas d'adresse e-mail valide pour répondre.", 400);
  }

  const trimmedSubject = (subject || '').trim();
  if (!trimmedSubject) {
    throw new AppError('Le sujet est obligatoire.', 400);
  }

  const trimmedMessage = (message || '').trim();
  if (!trimmedMessage) {
    throw new AppError('Le message de réponse est obligatoire.', 400);
  }

  const recipientName = `${msg.firstName || ''} ${msg.lastName || ''}`.trim() || 'Client';

  await sendContactReplyEmail(recipientEmail, {
    recipientName,
    subject: trimmedSubject,
    message: trimmedMessage,
  });

  const updated = await contactRepository.markAsResolved(id);

  return { success: true, message: 'Réponse envoyée avec succès.', contactMessage: updated };
}

