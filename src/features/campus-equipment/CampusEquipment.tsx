import './campus-equipment.css';
import { Html } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { CAMPUS_EXHIBITS, exhibitForDevice } from './campus-layout';
import { HALL_EXAMPLE_DEVICES, HALL_ZONES } from './hall-example-data';
import { ExhibitModel, HallIdle, StatusHalo } from './hall-exhibits';
import { useLang } from '@/hooks/useLang';

/** Lives inside the existing campus Canvas: no second renderer, camera or model loader. */
export default function CampusEquipment({ selected, onSelect, moving, reduced }: {
  selected: string | null; onSelect: (id: string) => void; moving: boolean; reduced: boolean;
}) {
  const zh = useLang() === 'zh';
  const invalidate = useThree(state => state.invalidate);
  useEffect(() => { invalidate(); }, [invalidate, selected, moving, reduced]);
  const active = exhibitForDevice(selected)?.id;
  return <group name="campus-equipment">
    {CAMPUS_EXHIBITS.map(exhibit => {
      const device = HALL_EXAMPLE_DEVICES.find(item => item.id === exhibit.id)!;
      const zone = HALL_ZONES.find(item => item.id === device.zone)!;
      return <group key={exhibit.id} name={`campus-exhibit-${exhibit.id}`} position={exhibit.position}
        onClick={event => { event.stopPropagation(); onSelect(exhibit.id); }}>
        <mesh position={[0, -.06, 0]} receiveShadow><cylinderGeometry args={[1.35, 1.4, .12, 24]} /><meshStandardMaterial color={active === exhibit.id ? '#90cbd2' : '#b6c7ce'} roughness={.65} /></mesh>
        <group rotation={[0, exhibit.rotation, 0]} scale={exhibit.scale}>
          <ExhibitModel kind={exhibit.kind} accent={exhibit.accent} moving={moving && !reduced && device.status !== 'offline'} />
          <StatusHalo id={exhibit.id} />
        </group>
        {active === exhibit.id && <Html position={[0, 2.7, 0]} center zIndexRange={[9, 5]}><button type="button" className="campus-equipment-label" onClick={() => onSelect(exhibit.id)}>{zone.id} · {zh ? zone.zh : zone.en}<small>{zh ? '结构与状态均为示例' : 'Example schematic and status'}</small></button></Html>}
      </group>;
    })}
    <HallIdle enabled={moving} reduced={reduced} />
  </group>;
}
