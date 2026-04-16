import { ChatPanel } from '@/components/chat-panel';

export default function HomePage() {
  return (
    <div className="grid gap-6 md:grid-cols-[1fr_320px]">
      <div className="rounded-2xl border border-white/5 bg-elevated/60 p-6 shadow-xl">
        <h1 className="text-2xl font-semibold tracking-tight mb-2">
          Talk to the NF Community AI
        </h1>
        <p className="text-sm text-white/60 mb-6">
          Describe what you want to build — a website, an app, an AI tool. The
          AI agents will classify intent, capture lead details, and draft a
          proposal in real time.
        </p>
        <ChatPanel />
      </div>

      <aside className="space-y-4">
        <div className="rounded-2xl border border-white/5 bg-elevated/60 p-5">
          <h2 className="text-sm font-semibold text-white/80 mb-3">How it works</h2>
          <ol className="space-y-2 text-sm text-white/60 list-decimal list-inside">
            <li>Your message → Orchestrator</li>
            <li>Intent classified (chat / lead / sales / …)</li>
            <li>Queued → dispatched to the right AI agent</li>
            <li>Structured lead + proposal drafted</li>
            <li>Stats update on the Dashboard in real time</li>
          </ol>
        </div>
        <div className="rounded-2xl border border-white/5 bg-elevated/60 p-5">
          <h2 className="text-sm font-semibold text-white/80 mb-3">Active Agents (Phase 1)</h2>
          <ul className="space-y-1 text-sm text-white/60">
            <li>• Community AI</li>
            <li>• Lead AI</li>
            <li>• Sales AI</li>
          </ul>
          <p className="text-xs text-white/40 mt-3">
            Project Manager, Builder, QA, Bug Fix and Growth agents ship in
            Phase 2–4.
          </p>
        </div>
      </aside>
    </div>
  );
}
