/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { handleApiRequest, type AuthEnv } from "./auth/api";
import { handleBusinessApiRequest } from "./business/api";

type WorkerEnv = AuthEnv & {
  ASSETS: Fetcher;
};

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      if (request.method !== "GET") {
        return Response.json({ error: "Method not allowed" }, { status: 405 });
      }

      try {
        await env.DB.prepare("SELECT 1 AS ok").first();
        return Response.json({ status: "ok", database: "ok" });
      } catch {
        return Response.json({ status: "degraded", database: "unavailable" }, { status: 503 });
      }
    }

    if (url.pathname.startsWith("/api/auth/") || url.pathname === "/api/profile") {
      return handleApiRequest(request, env);
    }

    if (url.pathname.startsWith("/api/")) {
      return handleBusinessApiRequest(request, env);
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const outputFormat =
            format === "image/jpeg" ||
            format === "image/png" ||
            format === "image/gif" ||
            format === "image/webp" ||
            format === "image/avif"
              ? format
              : "image/webp";
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({
            format: outputFormat,
            quality,
          });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
