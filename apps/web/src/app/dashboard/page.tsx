import { DashboardClient } from '@/components/dashboard-client';

export const dynamic = 'force-dynamic';

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">AI Company Dashboard</h1>
        <p className="text-sm text-white/60">
          Live view of conversations, leads, agent stats, and revenue.
        </p>
      </div>
      <DashboardClient />
    </div>
  );
}
