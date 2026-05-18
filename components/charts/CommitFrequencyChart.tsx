"use client";

import { Spinner } from "@/components/ui/Spinner";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

interface AuthorBreakdown { login: string; count: number; avatar_url: string }
interface DataPoint { recorded_at: string; commit_count: number; author_breakdown: AuthorBreakdown[] }

interface Props {
  data: DataPoint[];
  isLoading?: boolean;
  height?: number;
}

const COLORS = ["#6366f1", "#8b5cf6", "#a78bfa", "#c4b5fd"];

export function CommitFrequencyChart({ data, isLoading, height = 280 }: Props) {
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
        No commit data available
      </div>
    );
  }

  const authors = Array.from(
    new Set(data.flatMap((d) => d.author_breakdown.map((a) => a.login)))
  );

  const chartData = data.map((d) => {
    const entry: Record<string, string | number> = {
      date: new Date(d.recorded_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    };
    d.author_breakdown.forEach((a) => { entry[a.login] = a.count; });
    return entry;
  });

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {authors.map((author, i) => (
          <Bar key={author} dataKey={author} stackId="a" fill={COLORS[i % COLORS.length]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
