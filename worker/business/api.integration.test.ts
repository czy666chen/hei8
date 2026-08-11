import { applyD1Migrations, env, SELF } from "cloudflare:test";
import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

declare const __D1_MIGRATIONS__: D1Migration[];

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cloudflare {
    interface Env {
      REGISTRATION_INVITE_CODE: string;
      PASSWORD_HMAC_KEY: string;
      SESSION_HMAC_KEY: string;
    }
  }
}

type Account = { id: string; cookie: string };

beforeAll(async () => {
  await applyD1Migrations(env.DB, __D1_MIGRATIONS__);
});

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM card_events"),
    env.DB.prepare("DELETE FROM score_events"),
    env.DB.prepare("DELETE FROM match_audit_events"),
    env.DB.prepare("DELETE FROM match_claims"),
    env.DB.prepare("DELETE FROM sync_receipts"),
    env.DB.prepare("DELETE FROM match_players"),
    env.DB.prepare("DELETE FROM matches"),
    env.DB.prepare("DELETE FROM deck_cards"),
    env.DB.prepare("DELETE FROM deck_versions"),
    env.DB.prepare("DELETE FROM decks"),
    env.DB.prepare("DELETE FROM score_presets"),
    env.DB.prepare("DELETE FROM player_contacts"),
    env.DB.prepare("DELETE FROM player_invites"),
    env.DB.prepare("DELETE FROM devices"),
    env.DB.prepare("DELETE FROM auth_audit_events"),
    env.DB.prepare("DELETE FROM users"),
  ]);
});

function cookieValue(response: Response): string {
  return (response.headers.get("Set-Cookie") ?? "").split(";", 1)[0];
}

async function register(username: string): Promise<Account> {
  const response = await SELF.fetch("http://example.com/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://example.com" },
    body: JSON.stringify({ username, password: "secret1", inviteCode: "replace-with-test-invite-code" }),
  });
  expect(response.status).toBe(201);
  const payload = await response.clone().json() as { user: { id: string } };
  return { id: payload.user.id, cookie: cookieValue(response) };
}

function api(path: string, cookie?: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("Cookie", cookie);
  return SELF.fetch(`http://example.com${path}`, { ...init, headers });
}

function write(path: string, cookie: string, body: Record<string, unknown>): Promise<Response> {
  return api(path, cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://example.com" },
    body: JSON.stringify(body),
  });
}

async function device(account: Account, key: string): Promise<string> {
  const response = await write("/api/devices", account.cookie, { deviceKey: key, name: key });
  const payload = await response.json() as { device: { id: string } };
  return payload.device.id;
}

describe("R3 business authorization and cloud APIs", () => {
  it("requires a session for business collections and does not enumerate account data", async () => {
    const a = await register("account_a");
    const b = await register("account_b");
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO player_contacts (owner_user_id, contact_user_id, status, source, last_played_at) VALUES (?1, ?2, 'active', 'match', ?3)",
      ).bind(a.id, b.id, now),
      env.DB.prepare(
        "INSERT INTO score_presets (id, owner_user_id, name, rules_json) VALUES (?1, ?2, 'A preset', '{}')",
      ).bind(crypto.randomUUID(), a.id),
    ]);

    expect((await api("/api/history")).status).toBe(401);
    expect((await api("/api/contacts", b.cookie)).status).toBe(200);
    await expect((await api("/api/contacts", b.cookie)).json()).resolves.toEqual({ contacts: [] });
    const aContacts = await (await api("/api/contacts", a.cookie)).json() as { contacts: unknown[] };
    expect(aContacts.contacts).toHaveLength(1);
    await expect((await api("/api/presets", b.cookie)).json()).resolves.toEqual({ presets: [] });
  });

  it("scopes preset and deck ID lookups to the authenticated owner", async () => {
    const a = await register("account_a");
    const b = await register("account_b");
    const presetId = crypto.randomUUID();
    const deckId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO score_presets (id, owner_user_id, name, rules_json) VALUES (?1, ?2, 'private', '{}')")
        .bind(presetId, a.id),
      env.DB.prepare("INSERT INTO decks (id, owner_user_id, name) VALUES (?1, ?2, 'private')")
        .bind(deckId, a.id),
    ]);

    expect((await api(`/api/presets/${presetId}`, a.cookie)).status).toBe(200);
    expect((await api(`/api/decks/${deckId}`, a.cookie)).status).toBe(200);
    expect((await api(`/api/presets/${presetId}`, b.cookie)).status).toBe(404);
    expect((await api(`/api/decks/${deckId}`, b.cookie)).status).toBe(404);
  });

  it("imports local resources idempotently and scopes stable local IDs per account", async () => {
    const a = await register("account_a");
    const b = await register("account_b");
    const deviceA = await device(a, "migration-a");
    const deviceB = await device(b, "migration-b");
    const clientResourceId = "11111111-1111-5111-8111-111111111111";
    const operationId = "22222222-2222-5222-8222-222222222222";
    const snapshotJson = JSON.stringify({ id: "club-night", name: "周五俱乐部", rules: [{ id: "win", value: 4 }] });
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(snapshotJson));
    const checksum = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const body = {
      batchId: "a".repeat(64),
      deviceId: deviceA,
      item: { kind: "preset", localId: "club-night", resourceId: clientResourceId, operationId, snapshotJson, checksum },
    };

    const accepted = await write("/api/migrations/local", a.cookie, body);
    expect(accepted.status).toBe(201);
    const first = await accepted.json() as { result: string; resourceId: string };
    expect(first.result).toBe("accepted");

    const duplicate = await write("/api/migrations/local", a.cookie, body);
    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toMatchObject({ result: "duplicate", resourceId: first.resourceId });

    const other = await write("/api/migrations/local", b.cookie, { ...body, deviceId: deviceB });
    expect(other.status).toBe(201);
    const second = await other.json() as { resourceId: string };
    expect(second.resourceId).not.toBe(first.resourceId);

    const rows = await env.DB.prepare("SELECT id, owner_user_id FROM score_presets ORDER BY owner_user_id").all();
    expect(rows.results).toHaveLength(2);

    const invalid = await write("/api/migrations/local", a.cookie, {
      ...body,
      item: { ...body.item, operationId: crypto.randomUUID(), checksum: "0".repeat(64) },
    });
    expect(invalid.status).toBe(400);
  });

  it("restores an imported match through the same account on another registered device", async () => {
    const account = await register("sync_account");
    const sourceDevice = await device(account, "source-device");
    await device(account, "reader-device");
    const snapshot = {
      id: "local-eight-1",
      schemaVersion: 1,
      matchVersion: 3,
      mode: "chinese_eight",
      status: "completed",
      createdAt: 100,
      startedAt: 110,
      endedAt: 500,
      players: [{ id: "red", name: "红方" }, { id: "blue", name: "蓝方" }],
      events: [{ type: "round", sequenceNo: 1 }],
    };
    const snapshotJson = JSON.stringify(snapshot);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(snapshotJson));
    const checksum = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const response = await write("/api/migrations/local", account.cookie, {
      batchId: "b".repeat(64),
      deviceId: sourceDevice,
      item: {
        kind: "match",
        localId: snapshot.id,
        resourceId: "33333333-3333-5333-8333-333333333333",
        operationId: "44444444-4444-5444-8444-444444444444",
        snapshotJson,
        checksum,
      },
    });
    expect(response.status).toBe(201);
    const imported = await response.json() as { resourceId: string };

    const history = await (await api("/api/history", account.cookie)).json() as { matches: { id: string }[] };
    expect(history.matches.map((match) => match.id)).toContain(imported.resourceId);
    const restored = await (await api(`/api/matches/${imported.resourceId}`, account.cookie)).json() as {
      match: { snapshot_json: string };
      players: { nickname_snapshot: string }[];
    };
    expect(JSON.parse(restored.match.snapshot_json)).toEqual(snapshot);
    expect(restored.players.map((player) => player.nickname_snapshot)).toEqual(["红方", "蓝方"]);
  });

  it("allows a participant to read a match but only the leased owner device to write", async () => {
    const a = await register("account_a");
    const b = await register("account_b");
    const deviceA = await device(a, "device-a");
    const deviceB = await device(b, "device-b");
    const matchId = crypto.randomUUID();
    const playerA = crypto.randomUUID();
    const playerB = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO matches
          (id, owner_user_id, mode, status, version, write_lease_device_id, write_lease_expires_at)
         VALUES (?1, ?2, 'zhongba', 'active', 0, ?3, ?4)`,
      ).bind(matchId, a.id, deviceA, Date.now() + 60_000),
      env.DB.prepare(
        "INSERT INTO match_players (id, match_id, seat_no, user_id, nickname_snapshot) VALUES (?1, ?2, 0, ?3, 'A')",
      ).bind(playerA, matchId, a.id),
      env.DB.prepare(
        "INSERT INTO match_players (id, match_id, seat_no, user_id, nickname_snapshot) VALUES (?1, ?2, 1, ?3, 'B')",
      ).bind(playerB, matchId, b.id),
    ]);

    expect((await api(`/api/matches/${matchId}`, b.cookie)).status).toBe(200);
    const forbidden = await write(`/api/matches/${matchId}/score-events`, b.cookie, {
      operationId: "b-cannot-write", deviceId: deviceB, playerId: playerB, expectedVersion: 0, scoreDelta: 8,
    });
    expect(forbidden.status).toBe(403);
    expect((await api(`/api/matches/${matchId}`)).status).toBe(401);
    await expect(env.DB.prepare("SELECT count(*) AS count FROM score_events").first<number>("count")).resolves.toBe(0);
  });

  it("hides guessed private match IDs from another account", async () => {
    const a = await register("account_a");
    const b = await register("account_b");
    const matchId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO matches (id, owner_user_id, mode) VALUES (?1, ?2, 'classic')")
      .bind(matchId, a.id).run();

    const guessed = await api(`/api/matches/${matchId}`, b.cookie);
    expect(guessed.status).toBe(404);
    await expect(guessed.json()).resolves.toEqual({ error: "对局不存在" });
  });

  it("makes match creation and score events idempotent and rejects stale versions", async () => {
    const a = await register("account_a");
    const deviceA = await device(a, "device-a");
    const createBody = { operationId: "create-match-1", deviceId: deviceA, mode: "zhongba" };
    const created = await write("/api/matches", a.cookie, createBody);
    expect(created.status).toBe(201);
    const firstCreate = await created.json() as { match: { id: string } };
    const repeatedCreate = await write("/api/matches", a.cookie, createBody);
    await expect(repeatedCreate.json()).resolves.toEqual(firstCreate);
    await expect(env.DB.prepare("SELECT count(*) AS count FROM matches").first<number>("count")).resolves.toBe(1);

    const playerId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO match_players (id, match_id, seat_no, user_id, nickname_snapshot) VALUES (?1, ?2, 0, ?3, 'A')",
    ).bind(playerId, firstCreate.match.id, a.id).run();
    const eventBody = {
      operationId: "score-1", deviceId: deviceA, playerId, expectedVersion: 0, scoreDelta: 16,
    };
    const appended = await write(`/api/matches/${firstCreate.match.id}/score-events`, a.cookie, eventBody);
    expect(appended.status).toBe(201);
    const eventResponse = await appended.json();
    const repeated = await write(`/api/matches/${firstCreate.match.id}/score-events`, a.cookie, eventBody);
    await expect(repeated.json()).resolves.toEqual(eventResponse);

    const stale = await write(`/api/matches/${firstCreate.match.id}/score-events`, a.cookie, {
      ...eventBody, operationId: "score-stale", scoreDelta: 32,
    });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toEqual({ error: "版本冲突，请刷新后重试" });
    await expect(env.DB.prepare("SELECT count(*) AS count FROM score_events").first<number>("count")).resolves.toBe(1);
    await expect(env.DB.prepare("SELECT version FROM matches WHERE id = ?1").bind(firstCreate.match.id).first<number>("version"))
      .resolves.toBe(1);
  });

  it("scopes sync receipts and indexed history queries to the session user", async () => {
    const a = await register("account_a");
    const b = await register("account_b");
    const deviceA = await device(a, "device-a");
    await write("/api/matches", a.cookie, { operationId: "only-a", deviceId: deviceA, mode: "classic" });

    const aReceipts = await (await api("/api/sync/receipts", a.cookie)).json() as { receipts: unknown[] };
    const bReceipts = await (await api("/api/sync/receipts", b.cookie)).json() as { receipts: unknown[] };
    expect(aReceipts.receipts).toHaveLength(1);
    expect(bReceipts.receipts).toHaveLength(0);

    const historyPlan = await env.DB.prepare(
      "EXPLAIN QUERY PLAN SELECT id FROM matches WHERE owner_user_id = ?1 ORDER BY ended_at DESC",
    ).bind(a.id).all<{ detail: string }>();
    expect(historyPlan.results.some((row) => row.detail.includes("matches_owner_ended_idx"))).toBe(true);
    const contactsPlan = await env.DB.prepare(
      "EXPLAIN QUERY PLAN SELECT contact_user_id FROM player_contacts WHERE owner_user_id = ?1 ORDER BY last_played_at DESC",
    ).bind(a.id).all<{ detail: string }>();
    expect(contactsPlan.results.some((row) => row.detail.includes("player_contacts_owner_last_played_idx"))).toBe(true);
    const syncPlan = await env.DB.prepare(
      "EXPLAIN QUERY PLAN SELECT operation_id FROM sync_receipts WHERE user_id = ?1 AND received_at > ?2 ORDER BY received_at",
    ).bind(a.id, 0).all<{ detail: string }>();
    expect(syncPlan.results.some((row) => row.detail.includes("sync_receipts_user_received_idx"))).toBe(true);
    const matchDetailPlan = await env.DB.prepare(
      "EXPLAIN QUERY PLAN SELECT id FROM score_events WHERE match_id = ?1 ORDER BY sequence_no",
    ).bind(crypto.randomUUID()).all<{ detail: string }>();
    expect(matchDetailPlan.results.some((row) => row.detail.includes("score_events_match_sequence_uq"))).toBe(true);
  });
});
