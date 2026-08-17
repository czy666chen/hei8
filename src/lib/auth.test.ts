import { describe, expect, it } from "vitest";
import {
  AuthValidationError,
  digestPassword,
  normalizeUsername,
  parseSessionCookie,
  validatePassword,
  verifySecret,
} from "../../worker/auth/core";

describe("R3 authentication rules", () => {
  it("normalizes a valid username without changing its display spelling", () => {
    expect(normalizeUsername("  Player_01  ")).toEqual({
      normalized: "player_01",
      display: "Player_01",
    });
  });

  it("accepts a three-character username", () => {
    expect(normalizeUsername("Ab_")).toEqual({ normalized: "ab_", display: "Ab_" });
  });

  it.each(["ab", "has-dash", "中文名", "admin", "ROOT", "support"])(
    "rejects the invalid or reserved username %s",
    (username) => {
      expect(() => normalizeUsername(username)).toThrow(AuthValidationError);
    },
  );

  it("enforces the documented password length", () => {
    expect(() => validatePassword("12345")).toThrow(AuthValidationError);
    expect(() => validatePassword("a".repeat(65))).toThrow(AuthValidationError);
    expect(validatePassword("secret1")).toBe("secret1");
  });

  it("uses the approved password-v1 HMAC message", async () => {
    await expect(digestPassword("test-password-key", "alice", "secret1")).resolves.toBe(
      "c5a309ec5ff5d1e851088cfd7ce6d4e0399f52f8643bd5de88fd6d6ef6b5e476",
    );
  });

  it("compares secrets without accepting a prefix or different length", async () => {
    await expect(verifySecret("invite-code", "invite-code")).resolves.toBe(true);
    await expect(verifySecret("invite", "invite-code")).resolves.toBe(false);
    await expect(verifySecret("invite-code-x", "invite-code")).resolves.toBe(false);
  });

  it("reads only the exact session cookie", () => {
    expect(parseSessionCookie("theme=dark; hei8_session=token-123; other=value")).toBe("token-123");
    expect(parseSessionCookie("hei8_session_extra=wrong")).toBeNull();
  });
});
