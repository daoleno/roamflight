import * as T from 'three';

// Keep every source elevation and the atlas diagonal. Give the renderer local bounds so that
// a pilot with a 26 km view does not submit the entire 200 km regional grid.
export function streetBackdrop(atlas, terrain, heights, image) {
  const [cols, rows] = atlas.grid;
  const grid = new T.PlaneGeometry(
    (terrain.right - terrain.left) * 1000,
    (terrain.bottom - terrain.top) * 1000,
    cols - 1,
    rows - 1,
  );
  grid.rotateX(-Math.PI / 2);
  grid.translate((terrain.left + terrain.right) * 500, 0, (terrain.top + terrain.bottom) * 500);
  const position = grid.attributes.position;
  for (let i = 0; i < heights.length; i++) position.setY(i, heights[i] - 2);
  grid.computeVertexNormals();
  const material = new T.MeshLambertMaterial({ map: image }),
    group = new T.Group();
  const step = 16,
    point = new T.Vector3();
  for (let row = 0; row < rows - 1; row += step)
    for (let col = 0; col < cols - 1; col += step) {
      const lastRow = Math.min(row + step, rows - 1),
        lastCol = Math.min(col + step, cols - 1);
      const bounds = new T.Box3(),
        indices = [];
      for (let z = row; z <= lastRow; z++) {
        for (let x = col; x <= lastCol; x++)
          bounds.expandByPoint(point.fromBufferAttribute(position, z * cols + x));
        if (z < lastRow) {
          const start = (z * (cols - 1) + col) * 6;
          indices.push(...grid.index.array.subarray(start, start + (lastCol - col) * 6));
        }
      }
      const patch = new T.BufferGeometry();
      for (const [name, attribute] of Object.entries(grid.attributes))
        patch.setAttribute(name, attribute);
      patch.setIndex(indices);
      patch.boundingSphere = bounds.getBoundingSphere(new T.Sphere());
      const mesh = new T.Mesh(patch, material);
      mesh.renderOrder = 2;
      group.add(mesh);
    }
  return group;
}
