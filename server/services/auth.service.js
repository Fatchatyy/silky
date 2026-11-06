import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { runInTransaction } from '../repositories/transaction.repository.js';
import { userRepository } from '../repositories/user.repository.js';
import { mergeGuestSessionIntoUser } from './guestMerge.service.js';
import { signAccessToken } from './token.service.js';
import { AppError } from '../utils/errors.js';
import { env } from '../config/env.js';
import { sendPasswordResetEmail, sendWelcomeEmail } from './email.service.js';

const BCRYPT_ROUNDS = 12;

// Hash of a throw-away password. Login compares against it when the account does not exist (or is an admin),
// so an unknown identifier takes as long as a wrong password and the response time does not reveal which accounts exist.
const DUMMY_PASSWORD_HASH = '$2b$12$L8Wib2bXvb3ELY6bcCnUNuQcXDlcMbRjYxeKY0FdZuHulOeTIs4jm';
const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function safeEqual(a, b) {
  const left = crypto.createHash('sha256').update(String(a)).digest();
  const right = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(left, right);
}

function sanitizeUser(row) {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    fullName: row.full_name ?? row.fullName,
    phoneNumber: row.phone_number ?? row.phoneNumber ?? null,
    createdAt: row.created_at ?? row.createdAt ?? null,
    updatedAt: row.updated_at ?? row.updatedAt ?? null,
  };
}

function buildAuthResponse(userRow, token) {
  return {
    token,
    user: sanitizeUser(userRow),
  };
}

export async function registerUser({ identifier, email, password, fullName, phoneNumber, guestSessionId }) {
  const inputIdentifier = (identifier || email || phoneNumber || '').trim();
  if (!inputIdentifier || !password || !fullName?.trim()) {
    throw new AppError("L'adresse e-mail ou le numéro de téléphone, le mot de passe et le nom complet sont requis", 400);
  }

  if (password.length < 8) {
    throw new AppError('Le mot de passe doit contenir au moins 8 caractères', 400);
  }

  let finalEmail = null;
  let finalPhone = null;

  if (inputIdentifier.includes('@')) {
    if (!EMAIL_FORMAT.test(inputIdentifier)) {
      throw new AppError('Veuillez entrer une adresse e-mail valide.', 400);
    }
    finalEmail = inputIdentifier.toLowerCase();
    finalPhone = phoneNumber?.trim() || null;
  } else {
    const digitsOnly = inputIdentifier.replace(/\D/g, '');
    if (digitsOnly.length !== 8) {
      throw new AppError('Le numéro de téléphone doit contenir exactement 8 chiffres', 400);
    }
    finalPhone = digitsOnly;
    finalEmail = null;
  }

  const existing = await userRepository.findByIdentifier(inputIdentifier);
  if (existing) {
    if (inputIdentifier.includes('@')) {
      throw new AppError('Un compte avec cette adresse e-mail existe déjà', 409);
    } else {
      throw new AppError('Un compte avec ce numéro de téléphone existe déjà', 409);
    }
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const user = await runInTransaction(async (tx) => {
    const created = await userRepository.create({
      email: finalEmail,
      passwordHash,
      fullName: fullName.trim(),
      phoneNumber: finalPhone,
      role: 'customer',
    }, tx);

    await mergeGuestSessionIntoUser(created.id, guestSessionId, tx);

    return created;
  });

  if (user.email) {
    sendWelcomeEmail(user.email, user.fullName).catch((emailErr) => {
      console.error('[email] Failed to send welcome email:', emailErr.message);
    });
  }

  const token = signAccessToken(user);
  return buildAuthResponse(user, token);
}

export async function loginUser({ identifier, email, password, guestSessionId }) {
  const inputIdentifier = (identifier || email || '').trim();
  if (!inputIdentifier || !password) {
    throw new AppError("L'identifiant et le mot de passe sont requis", 400);
  }

  const user = await userRepository.findByIdentifier(inputIdentifier);
  if (!user || user.role === 'admin') {
    await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
    throw new AppError('Connexion impossible. Identifiants incorrects.', 401);
  }

  const passwordHash = await userRepository.findPasswordHashById(user.id);
  const valid = await bcrypt.compare(password, passwordHash);
  if (!valid) {
    throw new AppError('Connexion impossible. Identifiants incorrects.', 401);
  }

  await runInTransaction(async (tx) => {
    await mergeGuestSessionIntoUser(user.id, guestSessionId, tx);
  });

  const token = signAccessToken(user);
  return buildAuthResponse(user, token);
}

export async function requestPasswordReset(email) {
  if (!email?.trim()) {
    throw new AppError("L'adresse e-mail est obligatoire.", 400);
  }

  const user = await userRepository.findByEmail(email);

  // Always return success to avoid email enumeration
  if (!user) {
    return { message: 'If an account exists, a reset link has been sent.' };
  }

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + env.passwordResetExpiresHours * 60 * 60 * 1000);

  await userRepository.createPasswordReset(user.id, tokenHash, expiresAt);

  // Send the reset email — errors are logged but never bubble up so the
  // vague "we sent a link" response is always returned (no email enumeration).
  sendPasswordResetEmail(user.email, rawToken).catch((emailErr) => {
    console.error('[email] Failed to send password-reset email:', emailErr.message);
  });

  const payload = {
    message: 'If an account exists, a reset link has been sent.',
  };

  // Only expose the raw token in the response in development, when EXPOSE_RESET_TOKEN=true asks for it (never in
  // production, see env.exposeResetToken) and there are no real SMTP credentials (Ethereal / no-email dev mode).
  // Once SMTP_USER or RESEND_API_KEY is set the email is actually delivered, so the token must never appear in the API response.
  if (env.exposeResetToken && !env.smtpUser && !env.resendApiKey) {
    payload.resetToken = rawToken;
    payload.expiresAt = expiresAt.toISOString();
  }

  return payload;
}

export async function resetPassword({ token, newPassword }) {
  if (!token?.trim() || !newPassword) {
    throw new AppError('Le lien et le nouveau mot de passe sont requis.', 400);
  }

  if (newPassword.length < 8) {
    throw new AppError('Password must be at least 8 characters', 400);
  }

  const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex');
  const resetRecord = await userRepository.findValidPasswordReset(tokenHash);

  if (!resetRecord) {
    throw new AppError('Invalid or expired reset token', 400);
  }

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

  await runInTransaction(async (tx) => {
    await userRepository.updatePassword(resetRecord.userId || resetRecord.user_id, passwordHash, tx);
    await userRepository.markPasswordResetUsed(resetRecord.id, tx);
  });

  return { message: 'Password updated successfully' };
}

export async function updateProfile(userId, { fullName, phoneNumber, email }) {
  const currentUser = await userRepository.findById(userId);
  if (!currentUser) {
    throw new AppError('Utilisateur non trouvé', 404);
  }

  if (!fullName?.trim()) {
    throw new AppError('Le nom complet est requis', 400);
  }

  const currentEmail = currentUser.email ? currentUser.email.trim().toLowerCase() : null;
  const hasSubmittedEmail = email !== undefined && email !== null;
  const cleanSubmittedEmail = hasSubmittedEmail ? email.trim().toLowerCase() : undefined;

  let finalEmail = currentEmail;

  if (currentEmail !== null) {
    // User already has an email — strictly forbidden from clearing or saving empty email
    if (hasSubmittedEmail && !cleanSubmittedEmail) {
      throw new AppError("L'adresse e-mail est obligatoire.", 400);
    }
    if (hasSubmittedEmail && cleanSubmittedEmail !== currentEmail) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanSubmittedEmail)) {
        throw new AppError('Veuillez entrer une adresse e-mail valide.', 400);
      }
      const existingUser = await userRepository.findByEmail(cleanSubmittedEmail);
      if (existingUser && existingUser.id !== userId) {
        throw new AppError('Un compte avec cette adresse e-mail existe déjà', 409);
      }
      finalEmail = cleanSubmittedEmail;
    }
  } else {
    // Phone-only user — can add an email or keep it empty
    if (hasSubmittedEmail && cleanSubmittedEmail) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanSubmittedEmail)) {
        throw new AppError('Veuillez entrer une adresse e-mail valide.', 400);
      }
      const existingUser = await userRepository.findByEmail(cleanSubmittedEmail);
      if (existingUser && existingUser.id !== userId) {
        throw new AppError('Un compte avec cette adresse e-mail existe déjà', 409);
      }
      finalEmail = cleanSubmittedEmail;
    } else {
      finalEmail = null;
    }
  }

  let finalPhone = currentUser.phoneNumber ?? null;
  if (phoneNumber !== undefined) {
    const cleanPhone = phoneNumber ? phoneNumber.trim() : null;
    if (cleanPhone) {
      if (cleanPhone !== currentUser.phoneNumber) {
        const existingPhoneUser = await userRepository.findByIdentifier(cleanPhone);
        if (existingPhoneUser && existingPhoneUser.id !== userId) {
          throw new AppError('Un compte avec ce numéro de téléphone existe déjà', 409);
        }
      }
      finalPhone = cleanPhone;
    } else {
      finalPhone = null;
    }
  }

  if (!finalEmail && !finalPhone) {
    throw new AppError('Vous devez conserver au moins un e-mail ou un numéro de téléphone.', 400);
  }

  const updated = await userRepository.updateProfile(userId, {
    fullName: fullName.trim(),
    phoneNumber: finalPhone,
    email: finalEmail,
  });

  if (!updated) {
    throw new AppError('Utilisateur non trouvé', 404);
  }

  return { user: sanitizeUser(updated) };
}

export async function changePassword(userId, { currentPassword, newPassword }) {
  if (!currentPassword || !newPassword) {
    throw new AppError('Le mot de passe actuel et le nouveau mot de passe sont requis.', 400);
  }

  if (newPassword.length < 8) {
    throw new AppError('Password must be at least 8 characters', 400);
  }

  const passwordHash = await userRepository.findPasswordHashById(userId);
  if (!passwordHash) {
    throw new AppError('User not found', 404);
  }

  const valid = await bcrypt.compare(currentPassword, passwordHash);
  if (!valid) {
    throw new AppError('Current password is incorrect', 401);
  }

  const nextHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await userRepository.updatePassword(userId, nextHash);

  // The new password ended every earlier session, including this one: hand back a fresh token so the user stays signed in here.
  const user = await userRepository.findById(userId);
  return { message: 'Password updated successfully', token: signAccessToken(user) };
}

export async function getProfile(userId) {
  const user = await userRepository.findById(userId);
  if (!user) {
    throw new AppError('User not found', 404);
  }
  return { user: sanitizeUser(user) };
}

/** Legacy admin panel login — issues JWT for the seeded admin user. */
export async function adminPanelLogin(password) {

  if (typeof password !== 'string' || !safeEqual(password, env.adminPassword)) {
    throw new AppError('Invalid password', 401);
  }

  const admin = await userRepository.findByEmail(env.adminEmail);
  if (!admin || admin.role !== 'admin') {
    throw new AppError('Admin account not configured. Run db:seed first.', 503);
  }

  const token = signAccessToken(admin);
  return { token, user: sanitizeUser(admin) };
}
