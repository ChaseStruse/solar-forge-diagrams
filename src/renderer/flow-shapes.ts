import { BoxGeometry, ExtrudeGeometry, Shape } from 'three';

/** Unit geometries for flowchart process, decision and terminal shapes. */
export function createFlowGeometries(): Record<
  'process' | 'decision' | 'terminal',
  BoxGeometry | ExtrudeGeometry
> {
  const diamond = new Shape();
  diamond.moveTo(0, -0.5);
  diamond.lineTo(0.5, 0);
  diamond.lineTo(0, 0.5);
  diamond.lineTo(-0.5, 0);
  diamond.closePath();
  const rounded = new Shape();
  rounded.moveTo(-0.3, -0.5);
  rounded.lineTo(0.3, -0.5);
  rounded.quadraticCurveTo(0.5, -0.5, 0.5, -0.3);
  rounded.lineTo(0.5, 0.3);
  rounded.quadraticCurveTo(0.5, 0.5, 0.3, 0.5);
  rounded.lineTo(-0.3, 0.5);
  rounded.quadraticCurveTo(-0.5, 0.5, -0.5, 0.3);
  rounded.lineTo(-0.5, -0.3);
  rounded.quadraticCurveTo(-0.5, -0.5, -0.3, -0.5);
  const extrude = (shape: Shape) => {
    const geometry = new ExtrudeGeometry(shape, {
      depth: 1,
      bevelEnabled: false,
      curveSegments: 6,
    });
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, -0.5, 0);
    return geometry;
  };
  return {
    process: new BoxGeometry(1, 1, 1),
    decision: extrude(diamond),
    terminal: extrude(rounded),
  };
}
