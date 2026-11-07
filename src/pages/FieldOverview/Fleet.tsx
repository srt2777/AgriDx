import { useRef, useState } from 'react';
import { ArrowUpRight, ChevronRight, Search, Tractor, X } from 'lucide-react';
import {
  counts,
  kindNames,
  machines,
  statuses,
  statusNames,
  totals,
  type Machine,
  type Status,
} from './snapshot';

type Copy = (...labels: string[]) => string;
const colors = { working: '#3384e9', standby: '#f3b34e', offline: '#becbdb' };

export function FleetStatus({ t, inspect }: { t: Copy; inspect: (status: Status) => void }) {
  let offset = 0;
  return (
    <section className="fo-card fo-status">
      <div className="fo-panel-head">
        <h2>{t('机组状态', 'Fleet status')}</h2>
        <span className="fo-subtle">{t('当前快照', 'Snapshot')}</span>
      </div>
      <div className="fo-status-body">
        <div className="fo-ring" aria-label={`${totals.online} / ${machines.length} ${t('在线', 'online')}`}>
          <svg viewBox="0 0 120 120" aria-hidden="true">
            {statuses.map((status) => {
              const share = (counts[status] / machines.length) * 100,
                start = offset;
              offset += share;
              return (
                <circle
                  key={status}
                  cx="60"
                  cy="60"
                  r="49"
                  pathLength="100"
                  fill="none"
                  stroke={colors[status]}
                  strokeWidth="12"
                  strokeDasharray={`${share - 1.6} ${100 - share + 1.6}`}
                  strokeDashoffset={-start}
                  transform="rotate(-90 60 60)"
                />
              );
            })}
          </svg>
          <div>
            <strong>
              {Math.round((totals.online / machines.length) * 100)}
              <small>%</small>
            </strong>
            <span>{t('在线率', 'Online rate')}</span>
          </div>
        </div>
        <ul>
          {statuses.map((status) => (
            <li key={status}>
              <button type="button" onClick={() => inspect(status)}>
                <i style={{ backgroundColor: colors[status] }} />
                <span>{t(...statusNames[status])}</span>
                <b>{counts[status]}</b>
                <ChevronRight size={13} />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function FleetTable({
  t,
  filter,
  setFilter,
}: {
  t: Copy;
  filter: Status | 'all';
  setFilter: (status: Status | 'all') => void;
}) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Machine | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const rows = machines.filter(
    (m) =>
      (filter === 'all' || m.status === filter) &&
      [m.id, m.plot, ...kindNames[m.kind]].join(' ').toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <section className="fo-card fo-fleet" id="fo-fleet" tabIndex={-1}>
      <div className="fo-panel-head">
        <div className="fo-fleet-title">
          <h2>{t('农机台账', 'Fleet register')}</h2>
          <span>{machines.length}</span>
        </div>
        <div className="fo-filters">
          <label>
            <Search size={15} />
            <input
              type="search"
              value={search}
              placeholder={t('搜索编号、机型或地块', 'Search ID, type or plot')}
              aria-label={t('搜索农机', 'Search machines')}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <select
            value={filter}
            aria-label={t('筛选机组状态', 'Filter fleet status')}
            onChange={(e) => setFilter(e.target.value as Status | 'all')}
          >
            <option value="all">{t('全部状态', 'All states')}</option>
            {statuses.map((status) => (
              <option key={status} value={status}>
                {t(...statusNames[status])}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="fo-table-scroll">
        <table>
          <thead>
            <tr>
              {[
                t('农机 / 编号', 'Machine / ID'),
                t('作业地块', 'Plot'),
                t('当前状态', 'Status'),
                t('作业面积', 'Area'),
                t('作业时长', 'Hours'),
                t('详情', 'Details'),
              ].map((head) => (
                <th key={head}>{head}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id}>
                <td>
                  <div className="fo-machine-id">
                    <i>
                      <Tractor size={18} />
                    </i>
                    <span>
                      <strong>{t(...kindNames[m.kind])}</strong>
                      <small>{m.id}</small>
                    </span>
                  </div>
                </td>
                <td>{m.plot}</td>
                <td>
                  <span className={`fo-state ${m.status}`}>
                    <i />
                    {t(...statusNames[m.status])}
                  </span>
                </td>
                <td>
                  {m.area.toFixed(1)} {t('亩', 'mu')}
                </td>
                <td>{m.hours.toFixed(1)} h</td>
                <td>
                  <button
                    type="button"
                    className="fo-open"
                    aria-label={`${t('查看详情', 'View details')} ${m.id}`}
                    onClick={() => {
                      setSelected(m);
                      dialog.current?.showModal();
                    }}
                  >
                    <ArrowUpRight size={17} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && (
        <p className="fo-empty">
          {t('没有匹配的农机。', 'No matching machines.')}{' '}
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setFilter('all');
            }}
          >
            {t('清除筛选', 'Clear filters')}
          </button>
        </p>
      )}
      <dialog
        className="fo-dialog"
        ref={dialog}
        aria-labelledby="fo-machine-detail"
        onClick={(e) => {
          if (e.target === e.currentTarget) dialog.current?.close();
        }}
      >
        {selected && (
          <div>
            <header>
              <div>
                <span className="fo-subtle">{t('演示农机档案', 'Demo machine record')}</span>
                <h2 id="fo-machine-detail">
                  {selected.id} · {t(...kindNames[selected.kind])}
                </h2>
              </div>
              <button
                className="fo-open"
                type="button"
                autoFocus
                onClick={() => dialog.current?.close()}
                aria-label={t('关闭详情', 'Close details')}
              >
                <X size={19} />
              </button>
            </header>
            <dl>
              {[
                [t('当前状态', 'Status'), t(...statusNames[selected.status])],
                [t('作业地块', 'Plot'), selected.plot],
                [t('作业面积', 'Area'), `${selected.area.toFixed(1)} ${t('亩', 'mu')}`],
                [t('作业时长', 'Hours'), `${selected.hours.toFixed(1)} h`],
                [t('燃油消耗', 'Fuel'), `${selected.fuel.toFixed(1)} L`],
              ].map(([name, value]) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </dialog>
    </section>
  );
}
