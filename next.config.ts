import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    /** Visible en bandeja Mesa para validar Preview vs producción. */
    NEXT_PUBLIC_MESA_BANDEJA_BUILD_SHA:
      process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
  },
};

export default nextConfig;
