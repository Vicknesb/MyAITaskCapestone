"use client";

import { Spinner } from "@/components/ui/Spinner";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

interface DataPoint { recorded_at: string; open: number; merged: number; closed: number }

interface Props {
  data: DataPoint[];
  isLoading?: boolean;
  height?: number;
}

export function PRStatsChart({ data, isLoading, height = 280 }: Props) {
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
        No PR data available
      </div>
    );
  }

  const chartData = data.map((d) => ({
    date: new Date(d.recorded_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    open: d.open,
    merged: d.merged,
    closed: d.closed,
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Line type="monotone" dataKey="open" stroke="#f59e0b" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="merged" stroke="#6366f1" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="closed" stroke="#10b981" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
