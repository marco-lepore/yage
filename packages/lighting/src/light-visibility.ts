/** Texels across the edge texture. A power of two, so the row index is a shift. */
export const EDGE_TEXTURE_WIDTH = 256;
const EDGE_TEXTURE_WIDTH_MASK = EDGE_TEXTURE_WIDTH - 1;
const EDGE_TEXTURE_WIDTH_SHIFT = 8;

/**
 * Slots the lamp's width is divided into when the shader counts how much of it
 * an occluder hides, as four 32-bit masks. Each hidden stretch is rounded out
 * to whole slots at both ends, so a pixel's coverage sits within two slots of
 * the share the query computes exactly, per stretch of the lamp hidden from
 * it.
 */
export const COVERAGE_SLOTS = 128;

/**
 * Nearest depth, in world pixels from the shaded pixel, at which an edge still
 * projects onto the lamp. It matches `MIN_PROJECTION_DEPTH` in `occlusion.ts`.
 */
const MIN_DEPTH = 1e-3;

/**
 * Minimum projected half-width for finite lamps. Point lamps use segment
 * intersections; the coverage calculation clamps very small finite lamps
 * to avoid unbounded projection scales.
 */
const MIN_HALF_SIZE = 1e-2;

export const LIGHT_VISIBILITY_GL = /* glsl */ `
const float SLOT_SCALE = ${(COVERAGE_SLOTS / 2).toFixed(1)};
const float MIN_DEPTH = ${MIN_DEPTH};
const float MIN_HALF_SIZE = ${MIN_HALF_SIZE};
const uvec4 ALL_HIDDEN = uvec4(0xFFFFFFFFu);

vec4 readEdge(int index) {
  return texelFetch(
    uEdges,
    ivec2(index & ${EDGE_TEXTURE_WIDTH_MASK}, index >> ${EDGE_TEXTURE_WIDTH_SHIFT}),
    0
  );
}

/** Bits of the 32-slot word starting at \`base\` that lie in [first, last). */
uint wordBits(int first, int last, int base) {
  int low = clamp(first - base, 0, 32);
  int high = clamp(last - base, 0, 32);
  int count = high - low;
  if (count <= 0) return 0u;
  if (count >= 32) return 0xFFFFFFFFu;
  return ((1u << uint(count)) - 1u) << uint(low);
}

/** Hide the slots between two positions on the lamp's -1 to 1 scale. */
void hide(inout uvec4 mask, float spanStart, float spanEnd) {
  float low = clamp(spanStart, -1.0, 1.0);
  float high = clamp(spanEnd, -1.0, 1.0);
  if (!(high > low)) return;
  // Rounded outwards, so however thin a blocker is it never lets light past.
  int first = int(floor((low + 1.0) * SLOT_SCALE));
  int last = int(ceil((high + 1.0) * SLOT_SCALE));
  mask |= uvec4(
    wordBits(first, last, 0),
    wordBits(first, last, 32),
    wordBits(first, last, 64),
    wordBits(first, last, 96)
  );
}

/**
 * Hide what one occluder edge takes from the lamp. The edge is clipped to the
 * depth between the pixel and the lamp, and each surviving end is carried out
 * along its own ray to where it meets the lamp's line.
 */
void hideEdge(
  inout uvec4 mask,
  vec2 first,
  vec2 second,
  vec2 point,
  vec2 along,
  float depth,
  float halfSize
) {
  vec2 toFirst = first - point;
  vec2 toSecond = second - point;
  float firstDepth = dot(toFirst, along);
  float secondDepth = dot(toSecond, along);
  if (
    (firstDepth < MIN_DEPTH && secondDepth < MIN_DEPTH) ||
    (firstDepth > depth && secondDepth > depth)
  ) {
    return;
  }
  float firstSide = toFirst.y * along.x - toFirst.x * along.y;
  float secondSide = toSecond.y * along.x - toSecond.x * along.y;

  // The segment is outside one side of the pixel-to-lamp wedge. These linear
  // half-plane tests also hold after near/far clipping, without projection divides.
  if (
    (firstSide * depth > firstDepth * halfSize && secondSide * depth > secondDepth * halfSize) ||
    (firstSide * depth < -firstDepth * halfSize && secondSide * depth < -secondDepth * halfSize)
  ) return;

  float clipStart = 0.0;
  float clipEnd = 1.0;
  float depthSpan = secondDepth - firstDepth;
  if (depthSpan != 0.0) {
    float atNear = (MIN_DEPTH - firstDepth) / depthSpan;
    float atFar = (depth - firstDepth) / depthSpan;
    clipStart = max(clipStart, min(atNear, atFar));
    clipEnd = min(clipEnd, max(atNear, atFar));
    if (clipStart > clipEnd) return;
  }

  float scale = depth / halfSize;
  float startEnd =
    ((firstSide + (secondSide - firstSide) * clipStart) /
      (firstDepth + depthSpan * clipStart)) * scale;
  float endEnd =
    ((firstSide + (secondSide - firstSide) * clipEnd) /
      (firstDepth + depthSpan * clipEnd)) * scale;
  hide(mask, min(startEnd, endEnd), max(startEnd, endEnd));
}

/**
 * Hide what a disc takes. Its silhouette from the pixel is the chord between
 * the two points where the view of it grazes the outline; where the lamp's own
 * line runs through the disc, the chord between the two crossings covers the
 * lamp points buried in it.
 */
void hideDisc(
  inout uvec4 mask,
  vec2 center,
  float radius,
  vec2 point,
  vec2 along,
  float depth,
  float halfSize
) {
  vec2 toCenter = center - point;
  float centerDistance = length(toCenter);
  if (centerDistance <= radius) {
    mask = ALL_HIDDEN;
    return;
  }
  float sine = radius / centerDistance;
  float cosine = sqrt(max(0.0, 1.0 - sine * sine));
  float reach = centerDistance * cosine;
  vec2 unit = toCenter / centerDistance;
  hideEdge(
    mask,
    point + reach * vec2(unit.x * cosine - unit.y * sine, unit.x * sine + unit.y * cosine),
    point + reach * vec2(unit.x * cosine + unit.y * sine, unit.y * cosine - unit.x * sine),
    point,
    along,
    depth,
    halfSize
  );

  // The light sits at the origin here, so the lamp's line runs across \`along\`
  // through it and the offset from the disc's centre is the centre negated.
  vec2 offset = -center;
  vec2 across = vec2(-along.y, along.x);
  float midpoint = -dot(offset, across);
  float halfChordSquared =
    midpoint * midpoint - dot(offset, offset) + radius * radius;
  if (halfChordSquared <= 0.0) return;
  float halfChord = sqrt(halfChordSquared);
  hide(mask, (midpoint - halfChord) / halfSize, (midpoint + halfChord) / halfSize);
}

/**
 * Whether the ray going right from \`point\` crosses this edge. Counting the
 * crossings of one closed outline answers whether the outline holds the point.
 */
bool crossesRay(vec2 first, vec2 second, vec2 point) {
  if ((first.y > point.y) == (second.y > point.y)) return false;
  return point.x <
    ((second.x - first.x) * (point.y - first.y)) / (second.y - first.y) +
      first.x;
}

/** Set bits in one word. \`bitCount\` needs a later shader language. */
uint countBits(uint bits) {
  bits = bits - ((bits >> 1) & 0x55555555u);
  bits = (bits & 0x33333333u) + ((bits >> 2) & 0x33333333u);
  bits = (bits + (bits >> 4)) & 0x0F0F0F0Fu;
  return (bits * 0x01010101u) >> 24;
}

/** Point lamps need a segment intersection, without a finite lamp's coverage mask. */
bool pointShadowed(vec2 point, vec4 span) {
  float squaredDepth = dot(point, point);
  int base = int(span.x);
  int edges = int(span.y);
  int discs = int(span.z);
  for (int i = 0; i < edges; i++) {
    vec4 edge = readEdge(base + i);
    vec2 direction = edge.zw - edge.xy;
    float denominator = point.x * direction.y - point.y * direction.x;
    float alongRay = edge.x * direction.y - edge.y * direction.x;
    float alongEdge = edge.x * point.y - edge.y * point.x;
    if (denominator == 0.0 && alongEdge == 0.0) {
      float first = dot(edge.xy, point);
      float second = dot(edge.zw, point);
      if (max(first, second) >= 0.0 && min(first, second) <= squaredDepth) return true;
    }
    // Compare signed numerators rather than dividing by the determinant.
    if (denominator < 0.0) {
      denominator = -denominator;
      alongRay = -alongRay;
      alongEdge = -alongEdge;
    }
    if (denominator > 0.0 && alongRay >= 0.0 && alongRay <= denominator &&
        alongEdge >= 0.0 && alongEdge <= denominator) return true;
  }
  for (int i = 0; i < discs; i++) {
    vec4 disc = readEdge(base + edges + i);
    float at = clamp(dot(disc.xy, point) / squaredDepth, 0.0, 1.0);
    vec2 offset = disc.xy - point * at;
    if (dot(offset, offset) <= disc.z * disc.z) return true;
  }
  return false;
}

float lightWeight(vec2 point, vec2 reach, vec4 coneData, vec4 edgeSpan) {
  float radius = reach.x;
  float depth = length(point);
  if (depth >= radius) {
    return 0.0;
  }
  if (depth < MIN_DEPTH) {
    return 1.0;
  }

  vec2 toLight = -point / depth;
  // coneData: aim x, aim y, cosine where the light ends, cosine where it is full.
  float aimed = dot(-toLight, coneData.xy);
  float cone = coneData.w > coneData.z
    ? smoothstep(coneData.z, coneData.w, aimed)
    : (aimed >= coneData.z ? 1.0 : 0.0);
  if (cone <= 0.0) {
    return 0.0;
  }

  if (reach.y == 0.0) {
    return pointShadowed(point, edgeSpan) ? 0.0 : (1.0 - depth / radius) * cone;
  }

  float halfSize = max(reach.y, MIN_HALF_SIZE);
  int base = int(edgeSpan.x);
  int edges = int(edgeSpan.y);
  int discs = int(edgeSpan.z);
  int outlines = int(edgeSpan.w);
  uvec4 mask = uvec4(0u);

  // An outline the lamp reaches into carries its own run of edges here, and a
  // pixel inside it is dark however much of the lamp is buried in it too.
  int outlineBase = base + edges + discs;
  for (int i = 0; i < outlines; i++) {
    vec4 outline = readEdge(outlineBase + i);
    int start = base + int(outline.x);
    int count = int(outline.y);
    int crossings = 0;
    for (int k = 0; k < count; k++) {
      vec4 edge = readEdge(start + k);
      if (crossesRay(edge.xy, edge.zw, point)) crossings++;
    }
    if ((crossings & 1) == 1) {
      return 0.0;
    }
  }

  for (int i = 0; i < edges; i++) {
    vec4 edge = readEdge(base + i);
    hideEdge(mask, edge.xy, edge.zw, point, toLight, depth, halfSize);
    if (all(equal(mask, ALL_HIDDEN))) break;
  }
  for (int i = 0; i < discs; i++) {
    vec4 disc = readEdge(base + edges + i);
    hideDisc(mask, disc.xy, disc.z, point, toLight, depth, halfSize);
    if (all(equal(mask, ALL_HIDDEN))) break;
  }

  uint hidden =
    countBits(mask.x) + countBits(mask.y) + countBits(mask.z) + countBits(mask.w);
  float lit = 1.0 - float(hidden) / ${COVERAGE_SLOTS.toFixed(1)};
  float falloff = 1.0 - depth / radius;
  return falloff * lit * cone;
}
`;

export const LIGHT_VISIBILITY_WGSL = /* wgsl */ `
const SLOT_SCALE: f32 = ${(COVERAGE_SLOTS / 2).toFixed(1)};
const MIN_DEPTH: f32 = ${MIN_DEPTH};
const MIN_HALF_SIZE: f32 = ${MIN_HALF_SIZE};
const ALL_HIDDEN: vec4<u32> = vec4<u32>(0xFFFFFFFFu);

fn readEdge(index: i32) -> vec4<f32> {
  return textureLoad(
    uEdges,
    vec2<i32>(index & ${EDGE_TEXTURE_WIDTH_MASK}, index >> ${EDGE_TEXTURE_WIDTH_SHIFT}),
    0
  );
}

fn wordBits(first: i32, last: i32, base: i32) -> u32 {
  let low = clamp(first - base, 0, 32);
  let high = clamp(last - base, 0, 32);
  let count = high - low;
  if (count <= 0) { return 0u; }
  if (count >= 32) { return 0xFFFFFFFFu; }
  return ((1u << u32(count)) - 1u) << u32(low);
}

fn hide(mask: ptr<function, vec4<u32>>, spanStart: f32, spanEnd: f32) {
  let low = clamp(spanStart, -1.0, 1.0);
  let high = clamp(spanEnd, -1.0, 1.0);
  if (!(high > low)) { return; }
  let first = i32(floor((low + 1.0) * SLOT_SCALE));
  let last = i32(ceil((high + 1.0) * SLOT_SCALE));
  *mask = *mask | vec4<u32>(
    wordBits(first, last, 0),
    wordBits(first, last, 32),
    wordBits(first, last, 64),
    wordBits(first, last, 96)
  );
}

fn hideEdge(
  mask: ptr<function, vec4<u32>>,
  first: vec2<f32>,
  second: vec2<f32>,
  point: vec2<f32>,
  along: vec2<f32>,
  depth: f32,
  halfSize: f32
) {
  let toFirst = first - point;
  let toSecond = second - point;
  let firstDepth = dot(toFirst, along);
  let secondDepth = dot(toSecond, along);
  if (
    (firstDepth < MIN_DEPTH && secondDepth < MIN_DEPTH) ||
    (firstDepth > depth && secondDepth > depth)
  ) {
    return;
  }
  let firstSide = toFirst.y * along.x - toFirst.x * along.y;
  let secondSide = toSecond.y * along.x - toSecond.x * along.y;

  // Reject a segment outside either side of the pixel-to-lamp wedge before clipping.
  if (
    (firstSide * depth > firstDepth * halfSize && secondSide * depth > secondDepth * halfSize) ||
    (firstSide * depth < -firstDepth * halfSize && secondSide * depth < -secondDepth * halfSize)
  ) { return; }

  var clipStart = 0.0;
  var clipEnd = 1.0;
  let depthSpan = secondDepth - firstDepth;
  if (depthSpan != 0.0) {
    let atNear = (MIN_DEPTH - firstDepth) / depthSpan;
    let atFar = (depth - firstDepth) / depthSpan;
    clipStart = max(clipStart, min(atNear, atFar));
    clipEnd = min(clipEnd, max(atNear, atFar));
    if (clipStart > clipEnd) { return; }
  }

  let scale = depth / halfSize;
  let startEnd = ((firstSide + (secondSide - firstSide) * clipStart) /
    (firstDepth + depthSpan * clipStart)) * scale;
  let endEnd = ((firstSide + (secondSide - firstSide) * clipEnd) /
    (firstDepth + depthSpan * clipEnd)) * scale;
  hide(mask, min(startEnd, endEnd), max(startEnd, endEnd));
}

fn hideDisc(
  mask: ptr<function, vec4<u32>>,
  center: vec2<f32>,
  radius: f32,
  point: vec2<f32>,
  along: vec2<f32>,
  depth: f32,
  halfSize: f32
) {
  let toCenter = center - point;
  let centerDistance = length(toCenter);
  if (centerDistance <= radius) {
    *mask = ALL_HIDDEN;
    return;
  }
  let sine = radius / centerDistance;
  let cosine = sqrt(max(0.0, 1.0 - sine * sine));
  let reach = centerDistance * cosine;
  let unit = toCenter / centerDistance;
  hideEdge(
    mask,
    point + reach * vec2<f32>(unit.x * cosine - unit.y * sine, unit.x * sine + unit.y * cosine),
    point + reach * vec2<f32>(unit.x * cosine + unit.y * sine, unit.y * cosine - unit.x * sine),
    point,
    along,
    depth,
    halfSize
  );

  let offset = -center;
  let across = vec2<f32>(-along.y, along.x);
  let midpoint = -dot(offset, across);
  let halfChordSquared = midpoint * midpoint - dot(offset, offset) + radius * radius;
  if (halfChordSquared <= 0.0) { return; }
  let halfChord = sqrt(halfChordSquared);
  hide(mask, (midpoint - halfChord) / halfSize, (midpoint + halfChord) / halfSize);
}

fn crossesRay(first: vec2<f32>, second: vec2<f32>, point: vec2<f32>) -> bool {
  if ((first.y > point.y) == (second.y > point.y)) { return false; }
  return point.x <
    ((second.x - first.x) * (point.y - first.y)) / (second.y - first.y) +
      first.x;
}

fn pointShadowed(point: vec2<f32>, span: vec4<f32>) -> bool {
  let squaredDepth = dot(point, point);
  let base = i32(span.x);
  let edges = i32(span.y);
  let discs = i32(span.z);
  for (var i = 0; i < edges; i = i + 1) {
    let edge = readEdge(base + i);
    let direction = edge.zw - edge.xy;
    var denominator = point.x * direction.y - point.y * direction.x;
    var alongRay = edge.x * direction.y - edge.y * direction.x;
    var alongEdge = edge.x * point.y - edge.y * point.x;
    if (denominator == 0.0 && alongEdge == 0.0) {
      let first = dot(edge.xy, point);
      let second = dot(edge.zw, point);
      if (max(first, second) >= 0.0 && min(first, second) <= squaredDepth) { return true; }
    }
    if (denominator < 0.0) {
      denominator = -denominator;
      alongRay = -alongRay;
      alongEdge = -alongEdge;
    }
    if (denominator > 0.0 && alongRay >= 0.0 && alongRay <= denominator &&
        alongEdge >= 0.0 && alongEdge <= denominator) { return true; }
  }
  for (var i = 0; i < discs; i = i + 1) {
    let disc = readEdge(base + edges + i);
    let at = clamp(dot(disc.xy, point) / squaredDepth, 0.0, 1.0);
    let offset = disc.xy - point * at;
    if (dot(offset, offset) <= disc.z * disc.z) { return true; }
  }
  return false;
}

fn lightWeight(point: vec2<f32>, reach: vec2<f32>, coneData: vec4<f32>, edgeSpan: vec4<f32>) -> f32 {
  let radius = reach.x;
  let depth = length(point);
  if (depth >= radius) {
    return 0.0;
  }
  if (depth < MIN_DEPTH) {
    return 1.0;
  }

  let toLight = -point / depth;
  let cone = coneData;
  let aimed = dot(-toLight, cone.xy);
  var coneFactor: f32;
  if (cone.w > cone.z) {
    coneFactor = smoothstep(cone.z, cone.w, aimed);
  } else {
    coneFactor = select(0.0, 1.0, aimed >= cone.z);
  }
  if (coneFactor <= 0.0) {
    return 0.0;
  }

  if (reach.y == 0.0) {
    if (pointShadowed(point, edgeSpan)) { return 0.0; }
    return (1.0 - depth / radius) * coneFactor;
  }

  let halfSize = max(reach.y, MIN_HALF_SIZE);
  let base = i32(edgeSpan.x);
  let edges = i32(edgeSpan.y);
  let discs = i32(edgeSpan.z);
  let outlines = i32(edgeSpan.w);
  var mask = vec4<u32>(0u);

  // An outline the lamp reaches into carries its own run of edges here, and a
  // pixel inside it is dark however much of the lamp is buried in it too.
  let outlineBase = base + edges + discs;
  for (var i = 0; i < outlines; i = i + 1) {
    let outline = readEdge(outlineBase + i);
    let start = base + i32(outline.x);
    let count = i32(outline.y);
    var crossings = 0;
    for (var k = 0; k < count; k = k + 1) {
      let edge = readEdge(start + k);
      if (crossesRay(edge.xy, edge.zw, point)) { crossings = crossings + 1; }
    }
    if ((crossings & 1) == 1) {
      return 0.0;
    }
  }

  for (var i = 0; i < edges; i = i + 1) {
    let edge = readEdge(base + i);
    hideEdge(&mask, edge.xy, edge.zw, point, toLight, depth, halfSize);
    if (all(mask == ALL_HIDDEN)) { break; }
  }
  for (var i = 0; i < discs; i = i + 1) {
    let disc = readEdge(base + edges + i);
    hideDisc(&mask, disc.xy, disc.z, point, toLight, depth, halfSize);
    if (all(mask == ALL_HIDDEN)) { break; }
  }

  let hidden = countOneBits(mask.x) + countOneBits(mask.y) +
    countOneBits(mask.z) + countOneBits(mask.w);
  let lit = 1.0 - f32(hidden) / ${COVERAGE_SLOTS.toFixed(1)};
  let falloff = 1.0 - depth / radius;
  return falloff * lit * coneFactor;
}
`;
