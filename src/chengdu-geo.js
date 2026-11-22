import { DEG, EARTH_KM } from './geo.js';

// Kilometres east and south on a local equirectangular plane. North is -Z.
const latitudeKm = EARTH_KM * DEG;
const longitudeKm = latitudeKm * Math.cos(30.7 * DEG);
export function project([lon, lat]) {
  return [(lon - 104) * longitudeKm, (30.7 - lat) * latitudeKm];
}
export function geographic(x, z) {
  return [104 + x / longitudeKm, 30.7 - z / latitudeKm];
}
export function bearing(from, to) {
  const [x, z] = project(from),
    [tx, tz] = project(to);
  return (Math.atan2(tx - x, z - tz) / DEG + 360) % 360;
}
function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [a, b] = ring[j],
      [c, d] = ring[i];
    if (b > y !== d > y && x < a + ((y - b) * (c - a)) / (d - b)) inside = !inside;
  }
  return inside;
}
export function contains(area, coordinate) {
  return area.polygons.some(
    ([shell, ...holes]) => inRing(coordinate, shell) && !holes.some((h) => inRing(coordinate, h)),
  );
}
export function makeTerrain(atlas, samples) {
  const [west, south, east, north] = atlas.bounds,
    [cols, rows] = atlas.grid;
  const [left, top] = project([west, north]),
    [right, bottom] = project([east, south]);
  function meters(x, z) {
    const col = Math.min(cols - 1, Math.max(0, ((x - left) / (right - left)) * (cols - 1)));
    const row = Math.min(rows - 1, Math.max(0, ((z - top) / (bottom - top)) * (rows - 1)));
    const i = Math.min(cols - 2, Math.floor(col)),
      j = Math.min(rows - 2, Math.floor(row));
    const u = col - i,
      v = row - j,
      a = j * cols + i;
    // Same NE-SW diagonal as Three.PlaneGeometry, for exact terrain clearance.
    return u + v <= 1
      ? samples[a] * (1 - u - v) + samples[a + 1] * u + samples[a + cols] * v
      : samples[a + cols + 1] * (u + v - 1) +
          samples[a + 1] * (1 - v) +
          samples[a + cols] * (1 - u);
  }
  return { left, right, top, bottom, meters };
}
export const origin = [104.06322, 30.65976];
export const places = {
  square: ['天府广场', 'Tianfu Square', ...origin],
  fish: ['都江堰 · 鱼嘴', 'Dujiangyan · Fish Mouth', 103.60429, 31.00922],
  qingcheng: ['青城山', 'Mount Qingcheng', 103.55778, 30.9105],
  xiling: ['西岭雪山', 'Xiling Snow Mountain', 103.17, 30.69],
  bridge: ['安顺廊桥', 'Anshun Bridge', 104.0834, 30.64425],
  shuangliu: ['双流机场', 'Shuangliu Airport', 103.948, 30.561],
  tianfu: ['天府机场', 'Tianfu Airport', 104.444, 30.307],
  jianyang: ['简阳 · 沱江', 'Jianyang · Tuo River', 104.55321, 30.39155],
  pengzhou: ['彭州', 'Pengzhou', 103.94008, 30.98078],
  danjing: ['丹景山', 'Mount Danjing', 103.82388, 31.0958],
  pujiang: ['蒲江', 'Pujiang', 103.5196, 30.20078],
  xinglong: ['兴隆湖', 'Xinglong Lake', 104.082, 30.402],
};
export const routes = {
  west: ['fish', 'qingcheng', 'xiling'],
  east: ['bridge', 'tianfu', 'jianyang'],
  north: ['pengzhou', 'danjing'],
  south: ['shuangliu', 'pujiang'],
  lake: ['xinglong', 'square'],
};
