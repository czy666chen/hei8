import { digestSession, parseSessionCookie } from "./core";

export type SessionEnv = Env & {
  SESSION_HMAC_KEY: string;
};

export type SessionUser = {
  id: string;
  normalized_username: string;
  display_username: string;
  password_digest: string;
  password_version: number;
  status: string;
  public_code: string;
  nickname: string;
  avatar_url: string | null;
};

export type SessionContext = {
  tokenDigest: string;
  user: SessionUser;
};

function unauthorized(): Response {
  return Response.json(
    { error: "未登录或会话已失效" },
    {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

export async function findSession(env: SessionEnv, request: Request): Promise<SessionContext | null> {
  const token = parseSessionCookie(request.headers.get("Cookie"));
  if (!token) return null;

  const tokenDigest = await digestSession(env.SESSION_HMAC_KEY, token);
  const user = await env.DB.prepare(
    `SELECT u.id, u.normalized_username, u.display_username, u.password_digest,
            u.password_version, u.status, p.public_code, p.nickname, p.avatar_url
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       JOIN profiles p ON p.user_id = u.id
      WHERE s.token_digest = ?1 AND s.revoked_at IS NULL AND u.status = 'active'`,
  )
    .bind(tokenDigest)
    .first<SessionUser>();

  return user ? { tokenDigest, user } : null;
}

export async function requireSession(env: SessionEnv, request: Request): Promise<SessionContext> {
  const session = await findSession(env, request);
  if (!session) throw unauthorized();
  return session;
}
