import { handleApiRequest, type AuthEnv } from "./api";
import { handleBusinessApiRequest } from "../business/api";

export default {
  fetch(request: Request, env: AuthEnv): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    return pathname.startsWith("/api/auth/") || pathname === "/api/profile"
      ? handleApiRequest(request, env)
      : handleBusinessApiRequest(request, env);
  },
} satisfies ExportedHandler<AuthEnv>;
