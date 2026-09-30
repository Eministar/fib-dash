import type { NextConfig } from "next";
import path from "path";
import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import { createHash } from "crypto";

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
const mapVersion = createHash('sha256').update(readFileSync(path.join(__dirname, 'src/assets/map.png'))).digest('hex').slice(0, 16);

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  serverExternalPackages: ['better-sqlite3'],
  experimental: {
    // Folge-Builds auf dem Server nutzen den Cache in .next/ (Next 16: Beta, opt-in).
    turbopackFileSystemCacheForBuild: true,
  },
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
        source: '/((?!_next/static|api/map/image|icon.png|apple-icon.png|favicon.ico|shield.webp|logo.webp|logo-og.png|op-image.png|opengraph-image|twitter-image|uploads).*)',
        headers: [
          { key: 'Cache-Control', value: 'no-store, max-age=0' },
        ],
      },
    ]
  },
  env: {
    NEXT_PUBLIC_BUILD_ID: resolvedBuildId,
    NEXT_PUBLIC_MAP_VERSION: mapVersion,
    NEXT_PUBLIC_COMMIT_SHA: resolvedBuildId,
  },
};

export default nextConfig;
