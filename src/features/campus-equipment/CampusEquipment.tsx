import './campus-equipment.css';
import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { CAMPUS_EXHIBITS, exhibitForDevice } from './campus-layout';
import { HALL_EXAMPLE_DEVICES } from './hall-example-data';
import { ExhibitModel, HallIdle, StatusHalo } from './hall-exhibits';

/** Lives inside the existing campus Canvas: no second renderer, camera or model loader. */
export default function CampusEquipment({ selected, onSelect, moving, reduced }: {
  selected: string | null; onSelect: (id: string) => void; moving: boolean; reduced: boolean;
}) {
  const invalidate = useThree(state => state.invalidate);
  useEffect(() => { invalidate(); }, [invalidate, selected, moving, reduced]);
  const active = exhibitForDevice(selected)?.id;
  return <group name="campus-equipment">
    {CAMPUS_EXHIBITS.map(exhibit => {
      const device = HALL_EXAMPLE_DEVICES.find(item => item.id === exhibit.id)!;
      return <group key={exhibit.id} name={`campus-exhibit-${exhibit.id}`} position={exhibit.position}
        onClick={event => { event.stopPropagation(); onSelect(exhibit.id); }}>
        <mesh position={[0, -.06, 0]} receiveShadow><cylinderGeometry args={[1.35, 1.4, .12, 24]} /><meshStandardMaterial color={active === exhibit.id ? '#90cbd2' : '#b6c7ce'} roughness={.65} /></mesh>
        <group rotation={[0, exhibit.rotation, 0]} scale={exhibit.scale}>
          <ExhibitModel kind={exhibit.kind} accent={exhibit.accent} moving={moving && !reduced && device.status !== 'offline'} />
          <StatusHalo id={exhibit.id} />
        </group>
      </group>;
    })}
    <HallIdle enabled={moving} reduced={reduced} />
  </group>;
}
