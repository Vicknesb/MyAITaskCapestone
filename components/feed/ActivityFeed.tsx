"use client";

import { useMetrics } from "@/hooks/useMetrics";
import { ActivityFeedItem, ActivityItem } from "./ActivityFeedItem";
import { Spinner } from "@/components/ui/Spinner";

interface Props {
  repositoryId?: string;
  limit?: number;
  isLoading?: boolean;
}

export function ActivityFeed({ repositoryId, limit = 10 }: Props) {
  const { data: metrics = [], isLoading } = useMetrics(repositoryId ?? null, undefined, undefined, "CONTRIBUTOR");

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    );
  }

  const items: ActivityItem[] = metrics
    .flatMap((m) => {
      const payload = m.payload as { contributors?: { login: string; avatar_url: string; commits: number }[] };
      return (payload.contributors ?? []).map((c) => ({
        id: `${m.id}-${c.login}`,
        actor: c.login,
        actor_avatar: c.avatar_url,
        action: `made ${c.commits} commit${c.commits !== 1 ? "s" : ""}`,
        timestamp: m.recorded_at,
      }));
    })
    .slice(0, limit);

  if (!items.length) {
    return <p className="py-4 text-sm text-gray-400">No recent activity</p>;
  }

  return (
    <div className="divide-y divide-gray-100">
      {items.map((item) => (
        <ActivityFeedItem key={item.id} item={item} />
      ))}
    </div>
  );
}
