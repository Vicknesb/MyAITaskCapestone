export type CommitFreqPayload = {
  commit_count: number;
  author_breakdown: { login: string; count: number; avatar_url: string }[];
};

export type PrStatsPayload = {
  open: number;
  merged: number;
  closed: number;
  avg_merge_time_hrs: number;
  review_count: number;
};

export type ActivityPayload = {
  active_days: number;
  peak_hour: number;
  push_events: number;
};

export type ContributorPayload = {
  contributors: { login: string; avatar_url: string; commits: number; prs: number }[];
};

export type MetricPayload =
  | CommitFreqPayload
  | PrStatsPayload
  | ActivityPayload
  | ContributorPayload;
