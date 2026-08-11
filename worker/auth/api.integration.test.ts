import { applyD1Migrations, env, SELF } from "cloudflare:test";
import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { digestSession } from "./core";

declare const __D1_MIGRATIONS__: D1Migration[];

declare global {
  // Runtime test bindings augment the generated Cloudflare environment.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cloudflare {
    interface Env {
      REGISTRATION_INVITE_CODE: string;
      PASSWORD_HMAC_KEY: string;
      SESSION_HMAC_KEY: string;
    }
  }
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, __D1_MIGRATIONS__);
});

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM auth_audit_events"),
    env.DB.prepare("DELETE FROM users"),
  ]);
});

function post(path: string, body: Record<string, unknown>): Promise<Response> {
  return SELF.fetch(`http://example.com${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://example.com",
    },
    body: JSON.stringify(body),
  });
}

function cookieValue(response: Response): string {
  return (response.headers.get("Set-Cookie") ?? "").split(";", 1)[0];
}

async function expectCookieStored(cookie: string): Promise<void> {
  const token = cookie.slice(cookie.indexOf("=") + 1);
  const digest = await digestSession(env.SESSION_HMAC_KEY, token);
  const found = await env.DB.prepare("SELECT 1 AS found FROM sessions WHERE token_digest = ?1")
    .bind(digest)
    .first<number>("found");
  expect(found).toBe(1);
}

async function register(username = "Player_01", password = "secret1"): Promise<Response> {
  return post("/api/auth/register", {
    username,
    password,
    inviteCode: "replace-with-test-invite-code",
  });
}

describe("R3 authentication HTTP API", () => {
  it("rejects registration with the wrong invite code without storing a user", async () => {
    const response = await post("/api/auth/register", {
      username: "Player_01",
      password: "secret1",
      inviteCode: "wrong-code",
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "邀请码无效" });
    await expect(env.DB.prepare("SELECT count(*) AS count FROM users").first<number>("count")).resolves.toBe(0);
  });

  it("registers a user, stores only digests, and returns a secure session cookie", async () => {
    const response = await register();

    expect(response.status).toBe(201);
    const cookie = response.headers.get("Set-Cookie") ?? "";
    expect(cookie).toContain("hei8_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");

    const user = await env.DB.prepare(
      "SELECT normalized_username, password_digest FROM users WHERE normalized_username = ?1",
    )
      .bind("player_01")
      .first<{ normalized_username: string; password_digest: string }>();
    expect(user?.normalized_username).toBe("player_01");
    expect(user?.password_digest).toMatch(/^[a-f0-9]{64}$/);
    expect(user?.password_digest).not.toContain("secret1");

    const session = await env.DB.prepare("SELECT token_digest FROM sessions").first<{ token_digest: string }>();
    expect(session?.token_digest).toMatch(/^[a-f0-9]{64}$/);
    expect(cookie).not.toContain(session?.token_digest ?? "missing");
  });

  it("logs in case-insensitively, restores the session, and logs out", async () => {
    await register();
    const login = await post("/api/auth/login", { username: "PLAYER_01", password: "secret1" });
    expect(login.status).toBe(200);
    const cookie = cookieValue(login);

    const me = await SELF.fetch("http://example.com/api/auth/me", { headers: { Cookie: cookie } });
    expect(me.status).toBe(200);
    await expect(me.json()).resolves.toMatchObject({
      user: { normalizedUsername: "player_01", username: "Player_01" },
      session: { authenticated: true },
    });

    const logout = await SELF.fetch("http://example.com/api/auth/logout", {
      method: "POST",
      headers: { Cookie: cookie, Origin: "http://example.com" },
    });
    expect(logout.status).toBe(200);
    const afterLogout = await SELF.fetch("http://example.com/api/auth/me", { headers: { Cookie: cookie } });
    await expect(afterLogout.json()).resolves.toEqual({ user: null, session: { authenticated: false } });
  });

  it("uses one generic error for unknown users and wrong passwords", async () => {
    await register();
    const unknown = await post("/api/auth/login", { username: "nobody_1", password: "secret1" });
    const wrongPassword = await post("/api/auth/login", { username: "player_01", password: "wrong11" });
    expect(unknown.status).toBe(401);
    expect(wrongPassword.status).toBe(401);
    await expect(unknown.json()).resolves.toEqual({ error: "用户名或密码错误" });
    await expect(wrongPassword.json()).resolves.toEqual({ error: "用户名或密码错误" });
  });

  it("changes the password, revokes every other session, and issues one new session", async () => {
    const registered = await register();
    const firstCookie = cookieValue(registered);
    await expectCookieStored(firstCookie);
    const secondLogin = await post("/api/auth/login", { username: "player_01", password: "secret1" });
    const secondCookie = cookieValue(secondLogin);
    const firstSessionBeforeChange = await SELF.fetch("http://example.com/api/auth/me", {
      headers: { Cookie: firstCookie },
    });
    await expect(firstSessionBeforeChange.json()).resolves.toMatchObject({ session: { authenticated: true } });

    const changed = await SELF.fetch("http://example.com/api/auth/change-password", {
      method: "POST",
      headers: {
        Cookie: firstCookie,
        "Content-Type": "application/json",
        Origin: "http://example.com",
      },
      body: JSON.stringify({ currentPassword: "secret1", newPassword: "new-secret-2" }),
    });
    expect(changed.status).toBe(200);
    expect(cookieValue(changed)).not.toBe(firstCookie);

    const oldSession = await SELF.fetch("http://example.com/api/auth/me", { headers: { Cookie: secondCookie } });
    await expect(oldSession.json()).resolves.toEqual({ user: null, session: { authenticated: false } });
    expect((await post("/api/auth/login", { username: "player_01", password: "secret1" })).status).toBe(401);
    expect((await post("/api/auth/login", { username: "player_01", password: "new-secret-2" })).status).toBe(200);
  });

  it("updates profile fields without changing stable account identifiers", async () => {
    const registered = await register();
    const initial = (await registered.clone().json()) as { user: { id: string; publicCode: string } };
    const registeredCookie = cookieValue(registered);
    await expectCookieStored(registeredCookie);
    const sessionBeforeUpdate = await SELF.fetch("http://example.com/api/auth/me", {
      headers: { Cookie: registeredCookie },
    });
    await expect(sessionBeforeUpdate.json()).resolves.toMatchObject({ session: { authenticated: true } });
    const updated = await SELF.fetch("http://example.com/api/profile", {
      method: "PATCH",
      headers: {
        Cookie: registeredCookie,
        "Content-Type": "application/json",
        Origin: "http://example.com",
      },
      body: JSON.stringify({ nickname: "新昵称", avatarUrl: "https://example.com/avatar.png" }),
    });
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      user: {
        id: initial.user.id,
        publicCode: initial.user.publicCode,
        normalizedUsername: "player_01",
        nickname: "新昵称",
        avatarUrl: "https://example.com/avatar.png",
      },
    });
  });

  it("keeps at most ten active sessions per account", async () => {
    await register();
    for (let index = 0; index < 12; index += 1) {
      expect((await post("/api/auth/login", { username: "player_01", password: "secret1" })).status).toBe(200);
    }
    await expect(
      env.DB.prepare("SELECT count(*) AS count FROM sessions WHERE revoked_at IS NULL").first<number>("count"),
    ).resolves.toBe(10);
  });

  it("rejects cross-origin writes before reading credentials", async () => {
    const response = await SELF.fetch("http://example.com/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
      body: JSON.stringify({ username: "player_01", password: "secret1" }),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "请求来源无效", field: "request" });
  });

  it("returns a validation error instead of an internal error for an invalid avatar URL", async () => {
    const registered = await register();
    const response = await SELF.fetch("http://example.com/api/profile", {
      method: "PATCH",
      headers: {
        Cookie: cookieValue(registered),
        "Content-Type": "application/json",
        Origin: "http://example.com",
      },
      body: JSON.stringify({ avatarUrl: "not-a-url" }),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "头像地址无效", field: "request" });
  });

  it("rate limits repeated login failures without recording passwords", async () => {
    await register();
    for (let index = 0; index < 10; index += 1) {
      expect((await post("/api/auth/login", { username: "player_01", password: "wrong11" })).status).toBe(401);
    }
    expect((await post("/api/auth/login", { username: "player_01", password: "wrong11" })).status).toBe(429);
    const auditText = await env.DB.prepare(
      "SELECT group_concat(metadata_json, '') AS metadata FROM auth_audit_events",
    ).first<string>("metadata");
    expect(auditText).not.toContain("wrong11");
    expect(auditText).not.toContain("secret1");
  });
});
