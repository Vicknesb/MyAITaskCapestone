"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/apiClient";

export interface MetricRow {
  id: string;
  repository_id: string;
  type: "COMMIT_FREQ" | "PR_STATS" | "ACTIVITY" | "CONTRIBUTOR";
  recorded_at: string;
  period_days: number;
  payload: Record<string, unknown>;
}

export function useMetrics(
  repoId: string | null,
  from?: string,
  to?: string,
  type?: string
) {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (type) params.set("type", type);
  const qs = params.toString();

  return useQuery<MetricRow[]>({
    queryKey: ["metrics", repoId, from, to, type],
    queryFn: async () => {
      const result = await api.get<{ metrics: MetricRow[] }>(
        `/api/metrics/${repoId}${qs ? `?${qs}` : ""}`
      );
      return result.metrics;
    },
    enabled: !!repoId,
  });
}
