import { PrismaClient, MetricType, SyncStatus } from "@prisma/client";
import { randomBytes, createCipheriv, hkdfSync } from "crypto";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, 12);
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

function encryptToken(token: string, repoId: number): { enc: string; iv: string; tag: string } {
  const masterKey = Buffer.from(
    process.env.ENCRYPTION_KEY ?? "00000000000000000000000000000000000000000000",
    "base64"
  ).slice(0, 32);
  const derivedKey = Buffer.from(
    hkdfSync("sha256", masterKey, Buffer.alloc(0), String(repoId), 32)
  );
  const ivBuf = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derivedKey, ivBuf);
  const encBuf = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    enc: encBuf.toString("base64"),
    iv: ivBuf.toString("base64"),
    tag: tag.toString("base64"),
  };
}

// ─── Seed Data ───────────────────────────────────────────────────────────────

const USERS = [
  { email: "alice@devpulse.dev", name: "Alice Chen", password: "Password123!" },
  { email: "bob@devpulse.dev",   name: "Bob Kumar",  password: "Password123!" },
];

const REPOS = [
  {
    github_repo_id: 123456789,
    full_name: "acme-corp/frontend-app",
    owner: "acme-corp",
    name: "frontend-app",
    description: "Main customer-facing React application",
    is_private: true,
    default_branch: "main",
    token: "ghp_seed_token_frontend_app_0000000001",
  },
  {
    github_repo_id: 987654321,
    full_name: "acme-corp/api-service",
    owner: "acme-corp",
    name: "api-service",
    description: "Core REST API powering all client apps",
    is_private: true,
    default_branch: "main",
    token: "ghp_seed_token_api_service_000000000002",
  },
  {
    github_repo_id: 555000111,
    full_name: "acme-corp/design-system",
    owner: "acme-corp",
    name: "design-system",
    description: "Shared component library and Storybook",
    is_private: false,
    default_branch: "main",
    token: "ghp_seed_token_design_system_0000000003",
  },
];

// Realistic contributor set used across commit/PR payloads
const CONTRIBUTORS = [
  { login: "alice-chen",  avatar_url: "https://avatars.githubusercontent.com/u/1001?v=4" },
  { login: "bob-kumar",   avatar_url: "https://avatars.githubusercontent.com/u/1002?v=4" },
  { login: "carol-white", avatar_url: "https://avatars.githubusercontent.com/u/1003?v=4" },
  { login: "dave-singh",  avatar_url: "https://avatars.githubusercontent.com/u/1004?v=4" },
];

function makeCommitFreqPayload(seed: number) {
  const total = 20 + (seed % 30);
  return {
    commit_count: total,
    author_breakdown: CONTRIBUTORS.map((c, i) => ({
      login: c.login,
      avatar_url: c.avatar_url,
      count: Math.max(1, Math.floor(total / (i + 1.5))),
    })),
  };
}

function makePrStatsPayload(seed: number) {
  const merged = 4 + (seed % 8);
  return {
    open: 2 + (seed % 4),
    merged,
    closed: 1 + (seed % 3),
    avg_merge_time_hrs: parseFloat((18 + (seed % 30)).toFixed(1)),
    review_count: merged * 2 + (seed % 5),
  };
}

function makeActivityPayload(seed: number) {
  return {
    active_days: 3 + (seed % 5),
    peak_hour: 10 + (seed % 8),
    push_events: 10 + (seed % 20),
  };
}

function makeContributorPayload(seed: number) {
  return {
    contributors: CONTRIBUTORS.map((c, i) => ({
      login: c.login,
      avatar_url: c.avatar_url,
      commits: Math.max(1, 12 - i * 2 + (seed % 5)),
      prs: Math.max(0, 5 - i + (seed % 3)),
    })),
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🌱  Seeding DevPulse database...\n");

  // Clean slate
  await prisma.syncLog.deleteMany();
  await prisma.metric.deleteMany();
  await prisma.userRepository.deleteMany();
  await prisma.repository.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();

  // ── Users
  const createdUsers = await Promise.all(
    USERS.map((u) =>
      prisma.user.create({
        data: {
          email: u.email,
          name: u.name,
          password_hash: hashPassword(u.password),
        },
      })
    )
  );
  console.log(`✓  Created ${createdUsers.length} users`);

  // ── Repositories
  const createdRepos = await Promise.all(
    REPOS.map((r) => {
      const { enc, iv, tag } = encryptToken(r.token, r.github_repo_id);
      return prisma.repository.create({
        data: {
          github_repo_id: r.github_repo_id,
          full_name: r.full_name,
          owner: r.owner,
          name: r.name,
          description: r.description,
          is_private: r.is_private,
          default_branch: r.default_branch,
          github_token_enc: enc,
          token_iv: iv,
          token_tag: tag,
        },
      });
    })
  );
  console.log(`✓  Created ${createdRepos.length} repositories`);

  // ── UserRepository links  (alice owns all 3; bob owns first 2)
  const userRepoLinks = [
    { user: createdUsers[0], repo: createdRepos[0], role: "owner" },
    { user: createdUsers[0], repo: createdRepos[1], role: "owner" },
    { user: createdUsers[0], repo: createdRepos[2], role: "owner" },
    { user: createdUsers[1], repo: createdRepos[0], role: "viewer" },
    { user: createdUsers[1], repo: createdRepos[1], role: "owner" },
  ];
  await prisma.userRepository.createMany({
    data: userRepoLinks.map((l) => ({
      user_id: l.user.id,
      repository_id: l.repo.id,
      role: l.role,
    })),
  });
  console.log(`✓  Created ${userRepoLinks.length} user-repository links`);

  // ── Metrics  (30 days of weekly snapshots per repo)
  const metricRows: Parameters<typeof prisma.metric.create>[0]["data"][] = [];
  for (const repo of createdRepos) {
    for (let week = 0; week < 5; week++) {
      const recorded_at = daysAgo(week * 7);
      const seed = repo.github_repo_id + week * 7;

      const types: [MetricType, object][] = [
        [MetricType.COMMIT_FREQ,  makeCommitFreqPayload(seed)],
        [MetricType.PR_STATS,     makePrStatsPayload(seed)],
        [MetricType.ACTIVITY,     makeActivityPayload(seed)],
        [MetricType.CONTRIBUTOR,  makeContributorPayload(seed)],
      ];
      for (const [type, payload] of types) {
        metricRows.push({
          repository_id: repo.id,
          type,
          recorded_at,
          period_days: 7,
          payload,
        });
      }
    }
  }
  await prisma.metric.createMany({ data: metricRows as never });
  console.log(`✓  Created ${metricRows.length} metric snapshots (${REPOS.length} repos × 5 weeks × 4 types)`);

  // ── SyncLogs  (one successful past sync + one recent sync per repo)
  for (const repo of createdRepos) {
    // Historical sync — 14 days ago
    await prisma.syncLog.create({
      data: {
        repository_id: repo.id,
        status: SyncStatus.SUCCESS,
        triggered_by: "connect",
        started_at: daysAgo(14),
        finished_at: new Date(daysAgo(14).getTime() + 45_000),
        last_synced_at: daysAgo(14),
        items_fetched: 142,
        github_rate_remaining: 4872,
      },
    });
    // Recent sync — yesterday
    await prisma.syncLog.create({
      data: {
        repository_id: repo.id,
        status: SyncStatus.SUCCESS,
        triggered_by: "manual",
        started_at: daysAgo(1),
        finished_at: new Date(daysAgo(1).getTime() + 12_000),
        last_synced_at: daysAgo(1),
        items_fetched: 23,
        github_rate_remaining: 4991,
      },
    });
  }
  console.log(`✓  Created ${createdRepos.length * 2} sync log entries`);

  console.log("\n✅  Seed complete.\n");
  console.log("   Users:");
  for (const u of USERS) {
    console.log(`     ${u.email}  /  ${u.password}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
