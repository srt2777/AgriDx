import { useState } from 'react';
import { HALL_EXAMPLE_DEVICES, HALL_EXAMPLE_TOTAL, HALL_STATUS_EXAMPLE, HALL_ZONES, type HallZoneId } from './hall-example-data';
import { CAMPUS_EXHIBITS } from './campus-layout';
import { useLang } from '@/hooks/useLang';
import './campus-equipment.css';

export default function CampusEquipmentCatalog({ onSelect, moving, onMotion, reduced }: {
  onSelect: (id: string) => void; moving: boolean; onMotion: () => void; reduced: boolean;
}) {
  const zh = useLang() === 'zh';
  const [zone, setZone] = useState<HallZoneId | 'all'>('all');
  const shown = HALL_EXAMPLE_DEVICES.filter(item => zone === 'all' || item.zone === zone);
  let offset = 0;
  return <section id="campus-equipment-catalog" className="campus-equipment-catalog" aria-labelledby="campus-equipment-heading">
    <header><div><span>THE CAMPUS / EQUIPMENT</span><h2 id="campus-equipment-heading">{zh ? '大厅装备陈列' : 'Campus equipment collection'}</h2><p>{zh ? `${CAMPUS_EXHIBITS.length} 个三维结构示意 · ${HALL_EXAMPLE_TOTAL} 条示例设备记录。点击设备在园区定位；这些不是实车模型、铭牌规格或在线机队。` : `${CAMPUS_EXHIBITS.length} 3D schematics · ${HALL_EXAMPLE_TOTAL} example device records. Select a device to locate its schematic in the campus. Not measured models, plate specs or a live fleet.`}</p></div>
      <button type="button" disabled={reduced} aria-pressed={moving} onClick={onMotion}>{moving ? (zh ? '暂停机具动态' : 'Pause equipment motion') : (zh ? '播放机具动态' : 'Play equipment motion')}</button></header>
    <div className="campus-equipment-overview"><figure aria-label={zh ? '12条示例记录的状态分布，不是实车监测' : 'Status of 12 example records, not live monitoring'}><svg viewBox="0 0 120 120" role="img"><title>{zh ? '示例状态分布' : 'Example status distribution'}</title>
      {HALL_STATUS_EXAMPLE.map(item => { const start = offset; offset += item.count / HALL_EXAMPLE_TOTAL * 100; return <circle key={item.id} cx="60" cy="60" r="44" pathLength="100" fill="none" strokeWidth="10" className={`equipment-status-${item.id}`} strokeDasharray={`${item.count / HALL_EXAMPLE_TOTAL * 100} 100`} strokeDashoffset={-start} transform="rotate(-90 60 60)" />; })}
      <text x="60" y="58" textAnchor="middle">{HALL_EXAMPLE_TOTAL}</text><text x="60" y="77" textAnchor="middle" className="equipment-ring-caption">{zh ? '示例记录' : 'examples'}</text></svg></figure>
      <dl>{HALL_STATUS_EXAMPLE.map(item => <div key={item.id}><dt><i className={`equipment-status-${item.id}`} />{zh ? item.zh : item.en}</dt><dd>{item.count}<small>{zh ? '示例数据' : 'Example data'}</small></dd></div>)}</dl></div>
    <div className="campus-equipment-filters" role="group" aria-label={zh ? '装备分类筛选' : 'Equipment category filters'}><button type="button" aria-pressed={zone === 'all'} onClick={() => setZone('all')}>{zh ? '全部装备' : 'All equipment'}</button>{HALL_ZONES.map(item => <button type="button" key={item.id} aria-pressed={zone === item.id} onClick={() => setZone(item.id)}>{item.id} · {zh ? item.zh : item.en}</button>)}</div>
    <ul className="campus-equipment-list">{shown.map(item => { const status = HALL_STATUS_EXAMPLE.find(row => row.id === item.status)!; return <li key={item.id}><button type="button" onClick={() => onSelect(item.id)}><span className="equipment-device-title"><strong>{item.name}</strong><em className={`equipment-status-${item.status}`}>{zh ? status.zh : status.en} · {zh ? '示例' : 'example'}</em></span><span>{item.zone} · {zh ? item.specZh : item.specEn}</span><small>{zh ? '示例管理人' : 'Example manager'}：{item.manager}</small><span className="equipment-locate">{zh ? '在大厅定位结构示意 ↗' : 'Locate schematic in campus ↗'}</span></button></li>; })}</ul>
  </section>;
}
