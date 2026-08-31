/**
 * auth.js — JWT + bcrypt yardımcıları ve middleware'ler
 */

import jwt        from "jsonwebtoken";
import bcrypt     from "bcryptjs";
import { getUserById } from "./db.js";

/* ─────────────────────────────────────────────
   CONFIG
───────────────────────────────────────────── */
export const JWT_SECRET  = process.env.JWT_SECRET  || "kkr-super-secret-jwt-key-2026-change-in-prod";
export const JWT_EXPIRES = process.env.JWT_EXPIRES || "30d";
const SALT_ROUNDS = 12;

/* ─────────────────────────────────────────────
   PASSWORD
───────────────────────────────────────────── */
export async function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

/* ─────────────────────────────────────────────
   TOKEN
───────────────────────────────────────────── */
export function signToken(userId) {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

/* ─────────────────────────────────────────────
   MIDDLEWARE — zorunlu auth
───────────────────────────────────────────── */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token  = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ ok: false, error: "Token gerekli." });
  }

  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ ok: false, error: "Token geçersiz veya süresi dolmuş." });
  }

  const user = getUserById(payload.sub);
  if (!user) {
    return res.status(401).json({ ok: false, error: "Kullanıcı bulunamadı." });
  }

  req.user = user;
  next();
}

/* ─────────────────────────────────────────────
   MIDDLEWARE — opsiyonel auth (token varsa decode eder)
───────────────────────────────────────────── */
export function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || "";
  const token  = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (token) {
    const payload = verifyToken(token);
    if (payload) req.user = getUserById(payload.sub);
  }
  next();
}

/* ─────────────────────────────────────────────
   INPUT VALIDATION
───────────────────────────────────────────── */
export function validateRegister({ username, email, password }) {
  const errors = [];

  if (!username || username.trim().length < 3)
    errors.push("Kullanıcı adı en az 3 karakter olmalı.");
  if (username && username.trim().length > 30)
    errors.push("Kullanıcı adı en fazla 30 karakter olabilir.");
  if (username && !/^[a-zA-Z0-9_çğıöşüÇĞİÖŞÜ]+$/.test(username.trim()))
    errors.push("Kullanıcı adı sadece harf, rakam ve _ içerebilir.");

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
    errors.push("Geçerli bir e-posta adresi girin.");

  if (!password || password.length < 6)
    errors.push("Şifre en az 6 karakter olmalı.");
  if (password && password.length > 128)
    errors.push("Şifre çok uzun.");

  return errors;
}

export function validateLogin({ email, password }) {
  const errors = [];
  if (!email)    errors.push("E-posta gerekli.");
  if (!password) errors.push("Şifre gerekli.");
  return errors;
}

/* ─────────────────────────────────────────────
   SAFE USER (şifreyi dışarı verme)
───────────────────────────────────────────── */
export function safeUser(user) {
  if (!user) return null;
  const { password: _pw, ...safe } = user;
  return safe;
}
