"use client";

import { Spinner } from "@/components/ui/Spinner";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

interface DataPoint { recorded_at: string; push_events: number; active_days: number }

interface Props {
  data: DataPoint[];
  isLoading?: boolean;
  height?: number;
}

export function ActivityTimeline({ data, isLoading, height = 220 }: Props) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center" style={{ height }}>
        <Spinner />
      </div>
    );
  }
  if (!data.length) {
    return (
      <div className="flex items-center justify-center text-sm text-gray-400" style={{ height }}>
        No activity data available
      </div>
    );
  }

  const chartData = data.map((d) => ({
    date: new Date(d.recorded_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    pushEvents: d.push_events,
    activeDays: d.active_days,
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="gradPush" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip />
        <Area
          type="monotone"
          dataKey="pushEvents"
          stroke="#6366f1"
          fill="url(#gradPush)"
          strokeWidth={2}
          name="Push Events"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
