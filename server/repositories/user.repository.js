import { eq, or, and, gte } from 'drizzle-orm';
import { db } from '../db/orm.js';
import { users, passwordResets } from '../models/index.js';

export const userRepository = {
  async findById(id, tx = db) {
    if (!id) return null;
    const [user] = await tx.select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      phoneNumber: users.phoneNumber,
      role: users.role,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    }).from(users).where(eq(users.id, id));
    return user || null;
  },

  async findByEmail(email, tx = db) {
    if (!email) return null;
    const [user] = await tx.select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      phoneNumber: users.phoneNumber,
      role: users.role,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    }).from(users).where(eq(users.email, email.toLowerCase().trim()));
    return user || null;
  },

  async findByIdentifier(identifier, tx = db) {
    if (!identifier) return null;
    const cleaned = identifier.trim();
    const [user] = await tx.select().from(users).where(
      or(
        eq(users.email, cleaned.toLowerCase()),
        eq(users.phoneNumber, cleaned)
      )
    );
    return user || null;
  },

  async findPasswordHashById(id, tx = db) {
    if (!id) return null;
    const [row] = await tx.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, id));
    return row ? row.passwordHash : null;
  },

  async create({ email, passwordHash, fullName, phoneNumber, role = 'customer' }, tx = db) {
    const [newUser] = await tx.insert(users).values({
      email: email ? email.toLowerCase().trim() : null,
      passwordHash,
      fullName,
      phoneNumber: phoneNumber || null,
      role,
    }).returning({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      phoneNumber: users.phoneNumber,
      role: users.role,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    });
    return newUser;
  },

  async updateProfile(id, { fullName, phoneNumber, email }, tx = db) {
    const updateData = {
      fullName,
      updatedAt: new Date(),
    };
    if (phoneNumber !== undefined) {
      updateData.phoneNumber = phoneNumber || null;
    }
    if (email !== undefined) {
      updateData.email = email ? email.toLowerCase().trim() : null;
    }
    const [updated] = await tx.update(users)
      .set(updateData)
      .where(eq(users.id, id))
      .returning({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        phoneNumber: users.phoneNumber,
        role: users.role,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      });
    return updated || null;
  },

  /** Current role and revocation moment of an account, read on every authenticated request. */
  async findAuthState(id, tx = db) {
    if (!id) return null;
    const [row] = await tx.select({
      role: users.role,
      tokensValidAfter: users.tokensValidAfter,
    }).from(users).where(eq(users.id, id));
    return row || null;
  },

  /** Refuses every token issued before now (second precision, same clock as the token's iat). */
  async revokeTokens(userId, tx = db) {
    await tx.update(users)
      .set({ tokensValidAfter: new Date(Math.floor(Date.now() / 1000) * 1000) })
      .where(eq(users.id, userId));
  },

  async updatePassword(userId, passwordHash, tx = db) {
    const now = new Date();
    const [updated] = await tx.update(users)
      .set({
        passwordHash,
        updatedAt: now,
        // A new password ends every session opened with the old one.
        tokensValidAfter: new Date(Math.floor(now.getTime() / 1000) * 1000),
      })
      .where(eq(users.id, userId))
      .returning({ id: users.id });
    return updated || null;
  },

  async createPasswordReset(userId, tokenHash, expiresAt, tx = db) {
    const [reset] = await tx.insert(passwordResets).values({
      userId,
      tokenHash,
      expiresAt,
    }).returning();
    return reset;
  },

  async findValidPasswordReset(tokenHash, tx = db) {
    const [reset] = await tx.select().from(passwordResets).where(
      and(
        eq(passwordResets.tokenHash, tokenHash),
        eq(passwordResets.used, false),
        gte(passwordResets.expiresAt, new Date())
      )
    );
    return reset || null;
  },

  async markPasswordResetUsed(resetId, tx = db) {
    const [reset] = await tx.update(passwordResets)
      .set({ used: true })
      .where(eq(passwordResets.id, resetId))
      .returning();
    return reset || null;
  }
};
