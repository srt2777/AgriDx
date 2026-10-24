import { Fragment, useEffect, useId, useImperativeHandle, useRef, useState, type Ref, type RefObject } from 'react';
import { createGlassMaps, stepGlassSpring, type GlassInteraction, type GlassOpticsHandle } from '@/lib/glass-optics';

interface GlassLensProps {
  width: number;
  height: number;
  radius: number;
  blur: number;
  displacementScale: number;
  interaction: RefObject<GlassInteraction>;
  surface: RefObject<HTMLDivElement | null>;
  ref?: Ref<GlassOpticsHandle>;
}

function encodeMap(width: number, height: number, pixels: Uint8ClampedArray) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return '';
  const image = context.createImageData(width, height);
  image.data.set(pixels); context.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

/** Native backdrop samples the live page and WebGL; text and controls stay in normal DOM flow. */
export default function GlassLens({ width, height, radius, blur, displacementScale, interaction, surface, ref }: GlassLensProps) {
  const id = `material-glass-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const svg = useRef<SVGSVGElement>(null);
  const controller = useRef<GlassOpticsHandle>({ update: () => {} });
  const [maps, setMaps] = useState<{ normal: string; rim: string } | null>(null);
  useImperativeHandle(ref, () => ({ update: state => controller.current.update(state) }), []);

  useEffect(() => {
    const map = createGlassMaps(width, height, radius, matchMedia('(pointer: coarse)').matches ? 49_152 : 98_304);
    const normal = encodeMap(map.width, map.height, map.normal), rim = encodeMap(map.width, map.height, map.rim);
    setMaps(normal && rim ? { normal, rim } : null);
  }, [width, height, radius]);

  useEffect(() => {
    const element = surface.current;
    const channels = svg.current?.querySelectorAll('feDisplacementMap');
    const offset = svg.current?.querySelector('feOffset');
    if (!maps || !element || !channels || !offset) return;
    // Apply at the public surface boundary so overflow children never isolate the backdrop.
    element.style.setProperty('--lg-live-filter', `blur(${Math.max(.7, blur / 3)}px) saturate(115%) url("#${id}")`);
    element.setAttribute('data-glass-renderer', 'live');
    let frame = 0, previous = 0;
    const values = [1, 0, 0], velocities = [0, 0, 0], targets = [1, 0, 0];
    const attribute = (node: Element, name: string, value: string) => {
      if (node.getAttribute(name) !== value) node.setAttribute(name, value);
    };
    const paint = () => {
      channels.forEach((channel, i) => attribute(channel, 'scale', (-displacementScale * values[0] * (1 + i * .012)).toFixed(3)));
      attribute(offset, 'dx', values[1].toFixed(3)); attribute(offset, 'dy', values[2].toFixed(3));
    };
    const tick = (time: number) => {
      frame = 0;
      const dt = previous ? (time - previous) / 1000 : 1 / 60;
      previous = time;
      let settled = true;
      for (let i = 0; i < values.length; i++) {
        const next = stepGlassSpring(values[i], velocities[i], targets[i], dt);
        values[i] = next.position; velocities[i] = next.velocity; settled &&= next.settled;
      }
      paint();
      if (!settled) frame = requestAnimationFrame(tick); else previous = 0;
    };
    const update = (state: GlassInteraction) => {
      const next = [1 + (state.active ? Math.min(1, Math.hypot(state.x, state.y)) * .08 : 0) + (state.pressed ? .2 : 0),
        state.active ? Math.max(-1, Math.min(1, state.x)) * 1.2 : 0,
        state.active ? Math.max(-1, Math.min(1, state.y)) * 1.2 : 0];
      if (next.every((value, i) => value === targets[i] && value === values[i])) return;
      targets.splice(0, 3, ...next);
      if (!frame && !document.hidden) frame = requestAnimationFrame(tick);
    };
    const visibility = () => {
      cancelAnimationFrame(frame); frame = previous = 0;
      if (document.hidden) { values.splice(0, 3, 1, 0, 0); velocities.fill(0); paint(); }
      else update(interaction.current);
    };
    controller.current = { update };
    document.addEventListener('visibilitychange', visibility);
    paint(); update(interaction.current);
    return () => {
      cancelAnimationFrame(frame); controller.current = { update: () => {} };
      document.removeEventListener('visibilitychange', visibility);
      element.style.removeProperty('--lg-live-filter'); element.removeAttribute('data-glass-renderer');
    };
  }, [maps, id, blur, displacementScale, interaction, surface]);

  return <svg ref={svg} className="agri-live-optics" width="0" height="0" aria-hidden="true" data-glass-optics={maps ? 'live' : undefined}>
    {maps && <defs><filter id={id} filterUnits="userSpaceOnUse" x={-32} y={-32} width={width + 64} height={height + 64} colorInterpolationFilters="sRGB">
      <feImage href={maps.normal} x="0" y="0" width={width} height={height} preserveAspectRatio="none" result="normal" />
      <feImage href={maps.rim} x="0" y="0" width={width} height={height} preserveAspectRatio="none" result="rim" />
      <feOffset in="normal" result="lens" />
      {['red', 'green', 'blue'].map((channel, i) => <Fragment key={channel}>
        <feDisplacementMap in="SourceGraphic" in2="lens" scale={-displacementScale * (1 + i * .012)} xChannelSelector="R" yChannelSelector="B" result={`${channel}-bent`} />
        <feColorMatrix in={`${channel}-bent`} type="matrix" values={
          `${i === 0 ? 1 : 0} 0 0 0 0  0 ${i === 1 ? 1 : 0} 0 0 0  0 0 ${i === 2 ? 1 : 0} 0 0  0 0 0 1 0`
        } result={channel} />
      </Fragment>)}
      <feBlend in="red" in2="green" mode="screen" result="rg" />
      <feBlend in="rg" in2="blue" mode="screen" result="rgb" />
      <feComposite in="rgb" in2="rim" operator="in" result="edge" />
      <feComponentTransfer in="rim" result="center-mask"><feFuncA type="table" tableValues="1 0" /></feComponentTransfer>
      <feComposite in="SourceGraphic" in2="center-mask" operator="in" result="center" />
      <feComposite in="edge" in2="center" operator="over" />
    </filter></defs>}
  </svg>;
}
