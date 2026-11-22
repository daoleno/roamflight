import { streetRoot, decodeGzip } from './street-tiles.js';
import { guide, distanceLabel, categoryName } from './street-guide.js';
const $ = (id) => document.getElementById(id);
export function streetChart(tiles, index, flight, navigate, depart, close, districtAt) {
  const canvas = $('chart-ink'),
    ctx = canvas.getContext('2d'),
    center = { x: flight.x, z: flight.z };
  let span = 1400,
    selected = null,
    places = [],
    hits = [],
    signature = '',
    lastGeneration = -1,
    drag = null,
    loading;
  const scale = () => Math.min(innerWidth, innerHeight) / span;
  const px = (x, z) => [
    (x - center.x) * scale() + innerWidth / 2,
    (z - center.z) * scale() + innerHeight / 2,
  ];
  function select(p, pan = true) {
    selected = p;
    $('street-name').textContent = p[0];
    $('street-type').textContent =
      (index.districts[p[4]] || '成都市界外') + ' · ' + categoryName(p[1]) + ' · ' + p[5];
    const building = tiles.buildingAt(p[2], p[3]);
    const evidence = building
      ? ['高度缺资料，示意', '资料记载高度', '按层数估高', '2020 遥感估高', '廊屋示意高度'][
          building.mode
        ] +
        ' ' +
        building.height +
        ' m'
      : '';
    $('street-story').textContent = [p[6], evidence].filter(Boolean).join('　');
    $('street-source').hidden = !p[7];
    if (p[7]) $('street-source').href = p[7];
    $('street-info').hidden = false;
    $('street-results').replaceChildren();
    if (pan) {
      center.x = p[2];
      center.z = p[3];
    }
    signature = '';
  }
  function choices() {
    const query = $('street-query').value.trim();
    const matches = query
      ? [...guide, ...places]
          .filter((v) => v[0].includes(query))
          .sort(
            (a, b) =>
              Number(b[0] === query) - Number(a[0] === query) ||
              Number(guide.includes(b)) - Number(guide.includes(a)) ||
              Math.hypot(a[2] - flight.x, a[3] - flight.z) -
                Math.hypot(b[2] - flight.x, b[3] - flight.z),
          )
      : guide;
    const seen = new Set(),
      buttons = [];
    for (const p of matches) {
      const key = p[0] + '/' + p[4] + '/' + p[1];
      if (seen.has(key)) continue;
      seen.add(key);
      const b = document.createElement('button');
      b.textContent = seen.has(p[0]) ? p[0] + ' · ' + categoryName(p[1]) : p[0];
      seen.add(p[0]);
      b.title = (index.districts[p[4]] || '成都市界外') + ' · ' + categoryName(p[1]);
      b.onclick = () => {
        select(p);
        $('street-query').blur();
      };
      buttons.push(b);
      if (buttons.length >= 7) break;
    }
    $('street-results').replaceChildren(...buttons);
    if (query && !buttons.length)
      $('street-results').textContent =
        loading && !places.length ? '载入地点索引…' : '未找到该地名';
  }
  function loadPlaces() {
    if (!loading)
      loading = fetch(streetRoot + 'places.gzdata')
        .then((r) => {
          if (!r.ok) throw Error();
          return r.arrayBuffer();
        })
        .then((b) => {
          places = decodeGzip(b);
          if (document.activeElement === $('street-query')) choices();
        })
        .catch(() => {
          loading = null;
          $('street-results').textContent = '地点索引暂未载入，点击搜索可重试';
        });
  }
  $('street-query').oninput = choices;
  $('street-query').onfocus = () => {
    loadPlaces();
    choices();
  };
  $('street-nav').onclick = () => {
    if (selected) {
      navigate(selected);
      close();
    }
  };
  $('street-depart').onclick = () => {
    if (selected) {
      depart(selected);
      close();
    }
  };
  function zoom(f) {
    span = Math.max(260, Math.min(2600, span * f));
    signature = '';
  }
  $('street-plus').onclick = () => zoom(0.65);
  $('street-minus').onclick = () => zoom(1 / 0.65);
  $('street-locate').onclick = () => {
    center.x = flight.x;
    center.z = flight.z;
    signature = '';
  };
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoom(e.deltaY > 0 ? 1.2 : 1 / 1.2);
    },
    { passive: false },
  );
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    drag = [e.clientX, e.clientY, center.x, center.z];
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    center.x = drag[2] - (e.clientX - drag[0]) / scale();
    center.z = drag[3] - (e.clientY - drag[1]) / scale();
  });
  canvas.addEventListener('pointerup', (e) => {
    if (drag && Math.hypot(e.clientX - drag[0], e.clientY - drag[1]) < 7) {
      const nearest = hits
        .map(([p, x, y]) => [p, Math.hypot(x - e.clientX, y - e.clientY)])
        .sort((a, b) => a[1] - b[1])[0];
      if (nearest && nearest[1] < 22) select(nearest[0], false);
      else {
        const x = center.x + (e.clientX - innerWidth / 2) / scale();
        const z = center.z + (e.clientY - innerHeight / 2) / scale();
        if (tiles.buildingAt(x, z))
          select(['建筑轮廓', '建筑', x, z, districtAt(x, z), 'Overture / OSM'], false);
      }
    }
    drag = null;
  });
  canvas.onpointercancel = () => {
    drag = null;
  };
  function open(target) {
    center.x = flight.x;
    center.z = flight.z;
    span = 1400;
    signature = '';
    $('street-query').value = '';
    select(target, false);
    loadPlaces();
  }
  function draw(target) {
    const radius = span > 1800 ? 2 : 1;
    tiles.update(center.x, center.z, radius);
    const sig = [
      innerWidth,
      innerHeight,
      span,
      center.x,
      center.z,
      selected?.[0],
      target[0],
    ].join();
    if (signature === sig && lastGeneration === tiles.generation) return;
    signature = sig;
    lastGeneration = tiles.generation;
    const dpr = Math.min(devicePixelRatio, 1.5);
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#d1d8c8';
    ctx.fillRect(0, 0, innerWidth, innerHeight);
    for (const t of tiles.tiles.values()) {
      const [x, y] = px(t.ox, t.oz);
      ctx.drawImage(t.chart, x, y, tiles.size * scale() + 0.5, tiles.size * scale() + 0.5);
    }
    const [fx, fy] = px(flight.x, flight.z),
      [tx, ty] = px(target[2], target[3]);
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.lineTo(tx, ty);
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = '#ba641c';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
    const nearby = [];
    for (const t of tiles.tiles.values())
      for (const p of t.labels) nearby.push([p.name, p.category, p.x, p.z, p.district, p.source]);
    nearby.sort(
      (a, b) =>
        Math.hypot(a[2] - center.x, a[3] - center.z) - Math.hypot(b[2] - center.x, b[3] - center.z),
    );
    const labels = [...(selected ? [selected] : []), target, ...guide, ...nearby];
    hits = [];
    const boxes = [],
      names = new Set();
    ctx.font = '600 12px system-ui';
    ctx.textBaseline = 'middle';
    for (const p of labels) {
      const [x, y] = px(p[2], p[3]);
      if (x < 4 || x > innerWidth - 20 || y < 4 || y > innerHeight - 5 || names.has(p[0])) continue;
      const w = ctx.measureText(p[0]).width + 12;
      if (boxes.some(([a, b, c]) => Math.abs(y - b) < 21 && x < a + c + 8 && x + w > a)) continue;
      boxes.push([x, y, w]);
      names.add(p[0]);
      hits.push([p, x + w / 2, y]);
      const active = selected?.[0] === p[0] || p[0] === target[0];
      ctx.fillStyle = active ? '#174e49' : '#fbfaf1ed';
      ctx.fillRect(x + 3, y - 9, w, 18);
      ctx.fillStyle = active ? '#fff8cb' : '#394e46';
      ctx.fillText(p[0], x + 8, y);
      ctx.beginPath();
      ctx.arc(x, y, active ? 4 : 2.5, 0, Math.PI * 2);
      ctx.fillStyle = active ? '#cc721f' : '#547567';
      ctx.fill();
      if (hits.length > 70) break;
    }
    ctx.save();
    ctx.translate(fx, fy);
    ctx.rotate((flight.heading * Math.PI) / 180);
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(7, 8);
    ctx.lineTo(0, 5);
    ctx.lineTo(-7, 8);
    ctx.closePath();
    ctx.fillStyle = '#e87d19';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.restore();
    const metres = span < 600 ? 50 : span > 1800 ? 250 : 100;
    ctx.fillStyle = '#173e39';
    ctx.fillRect(18, innerHeight - 30, metres * scale(), 3);
    ctx.fillText(distanceLabel(metres), 18, innerHeight - 40);
  }
  return {
    open,
    draw,
    get span() {
      return span;
    },
    get selected() {
      return selected?.[0];
    },
  };
}
