"use client";

import { useDashboard, RepoDashboard } from "@/hooks/useDashboard";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import { CommitFrequencyChart } from "@/components/charts/CommitFrequencyChart";
import { PRStatsChart } from "@/components/charts/PRStatsChart";
import { ActivityTimeline } from "@/components/charts/ActivityTimeline";
import { ContributorChart } from "@/components/charts/ContributorChart";
import { useState } from "react";

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <p className="text-sm text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
    </Card>
  );
}

function RepoCharts({ repo }: { repo: RepoDashboard }) {
  const commitData = [{
    recorded_at: new Date().toISOString(),
    commit_count: repo.commit_freq.commit_count,
    author_breakdown: repo.commit_freq.author_breakdown,
  }];
  const prData = [{
    recorded_at: new Date().toISOString(),
    open: repo.pr_stats.open,
    merged: repo.pr_stats.merged,
    closed: repo.pr_stats.closed,
  }];
  const activityData = [{
    recorded_at: new Date().toISOString(),
    push_events: repo.activity.push_events,
    active_days: repo.activity.active_days,
  }];

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-gray-700">{repo.full_name}</h2>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card padding="sm">
          <CardHeader><CardTitle>Commit Frequency</CardTitle></CardHeader>
          <CommitFrequencyChart data={commitData} />
        </Card>
        <Card padding="sm">
          <CardHeader><CardTitle>PR Stats</CardTitle></CardHeader>
          <PRStatsChart data={prData} />
        </Card>
        <Card padding="sm">
          <CardHeader><CardTitle>Activity</CardTitle></CardHeader>
          <ActivityTimeline data={activityData} />
        </Card>
        <Card padding="sm">
          <CardHeader><CardTitle>Top Contributors</CardTitle></CardHeader>
          <ContributorChart data={repo.contributors.contributors} />
        </Card>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { data: dashboard, isLoading } = useDashboard();
  const [selectedRepoId, setSelectedRepoId] = useState<string>("all");

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!dashboard) {
    return (
      <div className="py-16 text-center text-sm text-gray-400">
        No dashboard data available. Connect a repository to get started.
      </div>
    );
  }

  const { summary, per_repo } = dashboard;
  const visibleRepos = selectedRepoId === "all"
    ? per_repo
    : per_repo.filter((r) => r.repository_id === selectedRepoId);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <select
          value={selectedRepoId}
          onChange={(e) => setSelectedRepoId(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="all">All repositories</option>
          {per_repo.map((r) => (
            <option key={r.repository_id} value={r.repository_id}>{r.full_name}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <SummaryCard label="Repositories" value={summary.repos_tracked} />
        <SummaryCard label="Total Commits" value={summary.total_commits} />
        <SummaryCard label="PRs Merged" value={summary.total_prs_merged} />
        <SummaryCard label="Active Contributors" value={summary.active_contributors} />
      </div>

      <div className="space-y-10">
        {visibleRepos.map((repo) => (
          <RepoCharts key={repo.repository_id} repo={repo} />
        ))}
      </div>
    </div>
  );
}
