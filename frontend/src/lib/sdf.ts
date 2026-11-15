// Signed-distance-field images: the one kind of map symbol that stays sharp at any size and any rotation, because the
// map draws its edge from distances instead of stretching a picture. Used for the small ship marks of a wide view.
// The distance transform is Felzenszwalb and Huttenlocher's, as used by MapLibre's own glyph renderer (tiny-sdf).

const INF = 1e20;
const RADIUS = 8, CUTOFF = 0.25;   // the encoding MapLibre expects: the edge sits at alpha 0.75, 8 px of distance either side

function edt1d(grid: Float64Array, offset: number, stride: number, length: number, f: Float64Array, v: Uint16Array, z: Float64Array) {
  v[0] = 0; z[0] = -INF; z[1] = INF; f[0] = grid[offset];
  for (let q = 1, k = 0, s = 0; q < length; q++) {
    f[q] = grid[offset + q * stride];
    const q2 = q * q;
    do { const r = v[k]; s = (f[q] - f[r] + q2 - r * r) / (q - r) / 2; } while (s <= z[k] && --k > -1);
    k++; v[k] = q; z[k] = s; z[k + 1] = INF;
  }
  for (let q = 0, k = 0; q < length; q++) {
    while (z[k + 1] < q) k++;
    const r = v[k], qr = q - r;
    grid[offset + q * stride] = f[r] + qr * qr;
  }
}
function edt(grid: Float64Array, size: number) {
  const f = new Float64Array(size), z = new Float64Array(size + 1), v = new Uint16Array(size);
  for (let x = 0; x < size; x++) edt1d(grid, x, size, size, f, v, z);
  for (let y = 0; y < size; y++) edt1d(grid, y * size, 1, size, f, v, z);
}

/** Alpha coverage (0..255, row by row, `size` x `size`) -> a distance field in the same layout. Pure, so it can be tested. */
export function distanceField(alpha: Uint8ClampedArray | number[], size: number): Uint8ClampedArray {
  const outer = new Float64Array(size * size), inner = new Float64Array(size * size);
  for (let i = 0; i < size * size; i++) {
    const a = alpha[i] / 255;
    outer[i] = a === 1 ? 0 : a === 0 ? INF : Math.max(0, 0.5 - a) ** 2;
    inner[i] = a === 1 ? INF : a === 0 ? 0 : Math.max(0, a - 0.5) ** 2;
  }
  edt(outer, size); edt(inner, size);
  const out = new Uint8ClampedArray(size * size);
  for (let i = 0; i < size * size; i++) out[i] = Math.round(255 - 255 * ((Math.sqrt(outer[i]) - Math.sqrt(inner[i])) / RADIUS + CUTOFF));
  return out;
}

/** Whatever `draw` paints, in a `box` x `box` unit square, as a distance-field image `size` px on a side.
 *  Only where it paints matters, not in what colour: the map colours a distance field itself. */
export function sdfImage(draw: (ctx: CanvasRenderingContext2D) => void, box: number, size: number): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.scale(size / box, size / box);
  draw(ctx);
  const drawn = ctx.getImageData(0, 0, size, size).data;
  const alpha = new Uint8ClampedArray(size * size);
  for (let i = 0; i < alpha.length; i++) alpha[i] = drawn[i * 4 + 3];
  const field = distanceField(alpha, size), image = new ImageData(size, size);
  for (let i = 0; i < field.length; i++) image.data[i * 4 + 3] = field[i];
  return image;
}
