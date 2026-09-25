import { createFileRoute, Link } from '@tanstack/react-router'
import { SourceBanner } from '../components/ui'
import { INSTITUTION_GROUPS, filterByGroup, formatCount, institutionGroup, type InstitutionGroup } from '../domain/pure'
import { loadMembers } from '../server/api'

type MemberSearch = { group?: InstitutionGroup }

export const Route = createFileRoute('/members')({
  validateSearch: (search: Record<string, unknown>): MemberSearch => {
    const group = search.group
    if (group === 'house' || group === 'senate' || group === 'whitehouse' || group === 'other') return { group }
    return {}
  },
  loader: () => loadMembers(),
  component: MembersPage,
})

const FILTERS: { id: InstitutionGroup | 'all'; label: string }[] = [{ id: 'all', label: 'All' }, ...INSTITUTION_GROUPS]

function MembersPage() {
  const data = Route.useLoaderData()
  const search = Route.useSearch()
  const group = search.group ?? 'all'
  const visible = filterByGroup(data.members, group)
  const sections = INSTITUTION_GROUPS.map((item) => ({
    ...item,
    members: visible.filter((member) => institutionGroup(member.chamber) === item.id),
  })).filter((section) => section.members.length > 0)
  return (
    <div className="min-w-0 space-y-3">
      <SourceBanner labeledSample={data.labeledSample} />
      <h1 className="font-mono text-sm tracking-wide text-ink">Members</h1>
      <p className="font-mono text-[11px] text-muted">
        {formatCount(visible.length)} filers · {formatCount(data.count)} disclosures
      </p>
      <nav aria-label="Institution" className="flex flex-wrap gap-2">
        {FILTERS.map((item) => (
          <Link
            key={item.id}
            to="/members"
            search={item.id === 'all' ? {} : { group: item.id }}
            className={`border px-2 py-1 font-mono text-[11px] ${group === item.id ? 'border-accent text-accent' : 'border-line text-muted'}`}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      {sections.map((section) => (
        <section key={section.id} data-group={section.id}>
          <h2 className="font-mono text-[11px] uppercase tracking-wider text-muted">{section.label}</h2>
          <ul className="divide-y divide-line border-y border-line">
            {section.members.map((member) => (
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
        </section>
      ))}
    </div>
  )
}
