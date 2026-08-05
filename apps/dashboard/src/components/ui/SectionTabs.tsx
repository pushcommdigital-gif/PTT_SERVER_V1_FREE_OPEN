import { NavLink } from 'react-router-dom';

export interface SectionTab {
  label: string;
  to: string;
  /** Match the path exactly (use for the index/parent tab). */
  end?: boolean;
}

/**
 * A horizontal underline tab strip for nesting a config screen inside its
 * parent (e.g. Roles under Users, Group Types under Groups). Each tab is a
 * route link, so the URL reflects the active sub-section.
 */
export function SectionTabs({ tabs }: { tabs: SectionTab[] }) {
  return (
    <div className="flex gap-1 border-b border-border mb-6">
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            `px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              isActive
                ? 'border-accent text-white'
                : 'border-transparent text-text-secondary hover:text-white'
            }`
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </div>
  );
}
