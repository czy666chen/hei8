export const USERNAME_HELP_TEXT = "用户名需 2-8 位，可包含字母、数字、下划线";

export function registrationUsernameError(value: string): string | null {
  const username = value.trim();
  if (username.length < 2) return "用户名至少 2 位";
  if (username.length > 8) return "用户名不能超过 8 位";
  if (!/^[A-Za-z0-9_]+$/.test(username)) return "用户名仅可包含字母、数字、下划线";
  return null;
}
