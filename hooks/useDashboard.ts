"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/apiClient";

export interface DashboardSummary {
  total_commits: number;
  total_prs_merged: number;
  active_contributors: number;
  repos_tracked: number;
}

export interface AuthorBreakdown {
  login: string;
  count: number;
  avatar_url: string;
}

export interface Contributor {
  login: string;
  avatar_url: string;
  commits: number;
  prs: number;
}

export interface RepoDashboard {
  repository_id: string;
  full_name: string;
  commit_freq: { commit_count: number; author_breakdown: AuthorBreakdown[] };
  pr_stats: { open: number; merged: number; closed: number; avg_merge_time_hrs: number; review_count: number };
  activity: { active_days: number; peak_hour: number; push_events: number };
  contributors: { contributors: Contributor[] };
}

export interface DashboardData {
  period: { from: string; to: string };
  summary: DashboardSummary;
  per_repo: RepoDashboard[];
}

export function useDashboard(from?: string, to?: string) {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();

  return useQuery<DashboardData>({
    queryKey: ["dashboard", from, to],
    queryFn: () => api.get<DashboardData>(`/api/dashboard${qs ? `?${qs}` : ""}`),
  });
}
