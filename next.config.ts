import type { NextConfig } from "next";
import path from "path";
import { execFileSync } from "child_process";

function configuredBuildId(value: string | undefined): string {
  const trimmed = value?.trim() ?? '';
  return trimmed && trimmed.toLowerCase() !== 'local' ? trimmed : '';
}

function resolveBuildId(): string {
  const configured = [
    process.env.VERCEL_GIT_COMMIT_SHA,
    process.env.GITHUB_SHA,
    process.env.NEXT_PUBLIC_COMMIT_SHA,
    process.env.NEXT_PUBLIC_BUILD_ID,
  ]
    .map(configuredBuildId)
    .find(Boolean);

  if (configured) return configured;

  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (sha) return sha;
  } catch {
    // Deploy environments without a checkout still get an explicit marker.
  }

  return 'unknown';
}

const resolvedBuildId = resolveBuildId();

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  serverExternalPackages: ['better-sqlite3'],
  images: {
    unoptimized: true,
    maximumDiskCacheSize: 0,
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'ALLOWALL' },
          { key: 'Content-Security-Policy', value: "frame-ancestors *" },
        ],
      },
      {
        source: '/((?!_next/static|favicon.ico|shield.webp|logo.webp|logo-og.png|op-image.png|opengraph-image|twitter-image|uploads).*)',
        headers: [
          { key: 'Cache-Control', value: 'no-store, max-age=0' },
        ],
      },
    ]
  },
  env: {
    NEXT_PUBLIC_BUILD_ID: resolvedBuildId,
    NEXT_PUBLIC_COMMIT_SHA: resolvedBuildId,
  },
};

export default nextConfig;
