import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { getUserById } from "./db.js";

const JWT_SECRET = String(process.env.JWT_SECRET || "");

if (JWT_SECRET.length < 32) {
  throw new Error(
    "JWT_SECRET eksik veya çok kısa. En az 32 karakterlik bir JWT_SECRET tanımlayın."
  );
}

export { JWT_SECRET };

export const JWT_EXPIRES =
  process.env.JWT_EXPIRES || "30d";

const SALT_ROUNDS = 12;

/* =========================================================
   PASSWORD
========================================================= */

export async function hashPassword(password) {
  return bcrypt.hash(String(password), SALT_ROUNDS);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(String(password), String(hash));
}

/* =========================================================
   TOKEN
========================================================= */

export function signToken(userId) {
  return jwt.sign(
    {
      sub: Number(userId)
    },
    JWT_SECRET,
    {
      expiresIn: JWT_EXPIRES
    }
  );
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

/* =========================================================
   AUTH MIDDLEWARE
========================================================= */

export function requireAuth(req, res, next) {
  try {
    const header =
      String(req.headers.authorization || "");

    if (!header.startsWith("Bearer ")) {
      return res.status(401).json({
        ok: false,
        error: "Token gerekli."
      });
    }

    const token =
      header.slice(7).trim();

    if (!token) {
      return res.status(401).json({
        ok: false,
        error: "Token gerekli."
      });
    }

    const payload =
      verifyToken(token);

    if (!payload || !payload.sub) {
      return res.status(401).json({
        ok: false,
        error: "Token geçersiz veya süresi dolmuş."
      });
    }

    const user =
      getUserById(Number(payload.sub));

    if (!user) {
      return res.status(401).json({
        ok: false,
        error: "Kullanıcı bulunamadı."
      });
    }

    req.user = user;

    next();
  } catch (error) {
    console.error(
      "[AUTH]",
      error
    );

    return res.status(401).json({
      ok: false,
      error: "Kimlik doğrulama başarısız."
    });
  }
}

/* =========================================================
   OPTIONAL AUTH
========================================================= */

export function optionalAuth(req, _res, next) {
  try {
    const header =
      String(req.headers.authorization || "");

    if (header.startsWith("Bearer ")) {
      const token =
        header.slice(7).trim();

      const payload =
        verifyToken(token);

      if (payload?.sub) {
        const user =
          getUserById(Number(payload.sub));

        if (user) {
          req.user = user;
        }
      }
    }
  } catch {
    // Opsiyonel auth olduğu için hata üretmiyoruz.
  }

  next();
}

/* =========================================================
   VALIDATION
========================================================= */

export function validateRegister({
  username,
  email,
  password
}) {
  const errors = [];

  const cleanUsername =
    typeof username === "string"
      ? username.trim()
      : "";

  const cleanEmail =
    typeof email === "string"
      ? email.trim()
      : "";

  if (
    !cleanUsername ||
    cleanUsername.length < 3
  ) {
    errors.push(
      "Kullanıcı adı en az 3 karakter olmalı."
    );
  }

  if (
    cleanUsername.length > 30
  ) {
    errors.push(
      "Kullanıcı adı en fazla 30 karakter olabilir."
    );
  }

  if (
    cleanUsername &&
    !/^[a-zA-Z0-9_çğıöşüÇĞİÖŞÜ]+$/.test(
      cleanUsername
    )
  ) {
    errors.push(
      "Kullanıcı adı sadece harf, rakam ve _ içerebilir."
    );
  }

  if (
    !cleanEmail ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
      cleanEmail
    )
  ) {
    errors.push(
      "Geçerli bir e-posta adresi girin."
    );
  }

  if (
    typeof password !== "string" ||
    password.length < 6
  ) {
    errors.push(
      "Şifre en az 6 karakter olmalı."
    );
  }

  if (
    typeof password === "string" &&
    password.length > 128
  ) {
    errors.push(
      "Şifre çok uzun."
    );
  }

  return errors;
}

export function validateLogin({
  email,
  password
}) {
  const errors = [];

  if (
    typeof email !== "string" ||
    !email.trim()
  ) {
    errors.push(
      "E-posta gerekli."
    );
  }

  if (
    typeof password !== "string" ||
    !password
  ) {
    errors.push(
      "Şifre gerekli."
    );
  }

  return errors;
}

/* =========================================================
   SAFE USER
========================================================= */

export function safeUser(user) {
  if (!user) {
    return null;
  }

  const {
    password: _password,
    ...safe
  } = user;

  return safe;
}