"use client";

import { Spinner } from "@/components/ui/Spinner";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";

interface Contributor { login: string; commits: number; prs: number; avatar_url: string }

interface Props {
  data: Contributor[];
  isLoading?: boolean;
}

export function ContributorChart({ data, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Spinner />
      </div>
    );
  }
  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-gray-400">
        No contributor data available
      </div>
    );
  }

  const sorted = [...data].sort((a, b) => b.commits - a.commits).slice(0, 8);

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart
        data={sorted}
        layout="vertical"
        margin={{ top: 4, right: 24, left: 60, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11 }} />
        <YAxis type="category" dataKey="login" tick={{ fontSize: 11 }} width={56} />
        <Tooltip />
        <Bar dataKey="commits" radius={[0, 4, 4, 0]}>
          {sorted.map((_, i) => (
            <Cell key={i} fill={i === 0 ? "#6366f1" : "#a5b4fc"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
