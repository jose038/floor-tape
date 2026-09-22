import { createFileRoute, Link } from '@tanstack/react-router'
import { SourceBanner } from '../components/ui'
import { formatCount } from '../domain/pure'
import { loadMembers } from '../server/api'

export const Route = createFileRoute('/members')({
  loader: () => loadMembers(),
  component: MembersPage,
})

function MembersPage() {
  const data = Route.useLoaderData()
  return (
    <div className="min-w-0 space-y-3">
      <SourceBanner labeledSample={data.labeledSample} />
      <h1 className="font-mono text-sm tracking-wide text-ink">Members</h1>
      <p className="font-mono text-[11px] text-muted">
        {formatCount(data.members.length)} filers · {formatCount(data.count)} disclosures
      </p>
      <ul className="divide-y divide-line border-y border-line">
        {data.members.map((member) => (
          <li key={member.memberId}>
            <Link to="/member/$id" params={{ id: member.memberId }} className="flex min-w-0 items-center gap-3 py-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center border border-line font-mono text-[11px] text-ink">
                {member.initials}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-ink">{member.politician}</span>
                <span className="block truncate font-mono text-[11px] text-muted">{member.seat}</span>
              </span>
              <span className="shrink-0 text-right font-mono text-[11px] text-muted">
                {formatCount(member.trades)}
                <span className="block">{member.lastFiled}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
