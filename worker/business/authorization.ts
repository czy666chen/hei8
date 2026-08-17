import { requireSession, type SessionContext, type SessionEnv } from "../auth/session";

export type MatchAccess = {
  id: string;
  owner_user_id: string;
  status: "draft" | "active" | "completed" | "cancelled";
  version: number;
  write_lease_device_id: string | null;
  write_lease_expires_at: number | null;
};

function jsonError(error: string, status: number): Response {
  return Response.json(
    { error },
    { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } },
  );
}

export async function requireMatchRead(
  env: SessionEnv,
  session: SessionContext,
  matchId: string,
): Promise<MatchAccess> {
  const match = await env.DB.prepare(
    `SELECT m.id, m.owner_user_id, m.status, m.version,
            m.write_lease_device_id, m.write_lease_expires_at
       FROM matches m
      WHERE m.id = ?1
        AND (
          m.owner_user_id = ?2
          OR EXISTS (
            SELECT 1 FROM match_players mp
             WHERE mp.match_id = m.id AND mp.user_id = ?2 AND mp.left_at IS NULL
          )
        )
        AND NOT EXISTS (
          SELECT 1 FROM match_user_states mus
           WHERE mus.match_id = m.id AND mus.user_id = ?2 AND mus.deleted_at IS NOT NULL
        )`,
  )
    .bind(matchId, session.user.id)
    .first<MatchAccess>();

  // Do not reveal whether a guessed private match ID exists.
  if (!match) throw jsonError("对局不存在", 404);
  return match;
}

export async function requireMatchWriteLease(
  env: SessionEnv,
  session: SessionContext,
  matchId: string,
  deviceId: string,
  now = Date.now(),
): Promise<MatchAccess> {
  const match = await requireMatchRead(env, session, matchId);
  if (match.owner_user_id !== session.user.id) throw jsonError("无权修改此对局", 403);
  if (match.status === "completed" || match.status === "cancelled") {
    throw jsonError("对局已结束，不能继续写入", 409);
  }

  const ownsLease = await env.DB.prepare(
    `SELECT 1 AS allowed
       FROM matches m
       JOIN devices d ON d.id = m.write_lease_device_id
      WHERE m.id = ?1
        AND m.owner_user_id = ?2
        AND d.id = ?3
        AND d.user_id = ?2
        AND d.revoked_at IS NULL
        AND m.write_lease_expires_at >= ?4`,
  )
    .bind(matchId, session.user.id, deviceId, now)
    .first<number>("allowed");

  if (!ownsLease) throw jsonError("当前设备没有有效的主写租约", 409);
  return match;
}

export { requireSession };
