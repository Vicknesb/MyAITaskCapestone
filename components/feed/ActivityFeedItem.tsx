import Image from "next/image";

export interface ActivityItem {
  id: string;
  actor: string;
  actor_avatar?: string;
  action: string;
  target?: string;
  timestamp: string;
}

export function ActivityFeedItem({ item }: { item: ActivityItem }) {
  const relative = (() => {
    const diff = Date.now() - new Date(item.timestamp).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  })();

  return (
    <div className="flex items-start gap-3 py-3">
      {item.actor_avatar ? (
        <Image
          src={item.actor_avatar}
          alt={item.actor}
          width={32}
          height={32}
          className="rounded-full"
        />
      ) : (
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-xs font-medium text-indigo-600">
          {item.actor[0]?.toUpperCase()}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-700">
          <span className="font-medium">{item.actor}</span>{" "}
          {item.action}
          {item.target && <span className="font-medium"> {item.target}</span>}
        </p>
        <p className="text-xs text-gray-400">{relative}</p>
      </div>
    </div>
  );
}
