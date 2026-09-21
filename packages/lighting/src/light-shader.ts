import { Geometry, GlProgram, GpuProgram, Shader } from "pixi.js";
import type { TextureSource } from "pixi.js";

/**
 * @internal The GPU side of {@link ShaderLightingRenderer}: one quad per light,
 * shaded per pixel by the same projection `LightingWorld.levelAt()` runs on the
 * processor.
 *
 * Every occluder edge and disc in reach of any light sits in one data texture,
 * and each light reads the run that belongs to it. The shader works in
 * light-local world pixels — the pixel, the edges and the lamp are all measured
 * from the light itself — so a scene far from the origin does not spend float
 * precision on its own coordinates.
 */

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
 * Half-width the shader gives a lamp of `size: 0`. At this width every edge
 * across the line to the light covers the lamp end to end, which is the hard
 * shadow a point lamp casts, and no lamp a game sets is this thin.
 */
const MIN_HALF_SIZE = 1e-2;

const VERTEX_GL = /* glsl */ `
in vec2 aPosition;
out vec2 vLocal;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

void main(void) {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vLocal = aPosition;
}
`;

const FRAGMENT_GL = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
// The shader language gives a sampler lowp by default, which would round the
// edge texture's coordinates to half floats on a driver that honours it.
precision highp sampler2D;

in vec2 vLocal;
out vec4 finalColor;

uniform vec3 uLightColor;
uniform vec2 uReach;
uniform vec4 uCone;
uniform vec4 uEdgeSpan;
uniform sampler2D uEdges;

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

void main(void) {
  float radius = uReach.x;
  vec2 point = vLocal * radius;
  float depth = length(point);
  if (depth >= radius) {
    finalColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  if (depth < MIN_DEPTH) {
    finalColor = vec4(uLightColor, 1.0);
    return;
  }

  vec2 toLight = -point / depth;
  // uCone: aim x, aim y, cosine where the light ends, cosine where it is full.
  float aimed = dot(-toLight, uCone.xy);
  float cone = uCone.w > uCone.z
    ? smoothstep(uCone.z, uCone.w, aimed)
    : (aimed >= uCone.z ? 1.0 : 0.0);
  if (cone <= 0.0) {
    finalColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  float halfSize = max(uReach.y, MIN_HALF_SIZE);
  int base = int(uEdgeSpan.x);
  int edges = int(uEdgeSpan.y);
  int discs = int(uEdgeSpan.z);
  int outlines = int(uEdgeSpan.w);
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
      finalColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
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
  finalColor = vec4(uLightColor * (falloff * lit * cone), 1.0);
}
`;

const SHADER_WGSL = /* wgsl */ `
struct GlobalUniforms {
  uProjectionMatrix: mat3x3<f32>,
  uWorldTransformMatrix: mat3x3<f32>,
  uWorldColorAlpha: vec4<f32>,
  uResolution: vec2<f32>,
};

struct LocalUniforms {
  uTransformMatrix: mat3x3<f32>,
  uColor: vec4<f32>,
  uRound: f32,
};

struct LightUniforms {
  uLightColor: vec3<f32>,
  uReach: vec2<f32>,
  uCone: vec4<f32>,
  uEdgeSpan: vec4<f32>,
};

@group(0) @binding(0) var<uniform> globalUniforms : GlobalUniforms;
@group(1) @binding(0) var<uniform> localUniforms : LocalUniforms;
@group(2) @binding(0) var<uniform> lightUniforms : LightUniforms;
@group(2) @binding(1) var uEdges : texture_2d<f32>;

const SLOT_SCALE: f32 = ${(COVERAGE_SLOTS / 2).toFixed(1)};
const MIN_DEPTH: f32 = ${MIN_DEPTH};
const MIN_HALF_SIZE: f32 = ${MIN_HALF_SIZE};
const ALL_HIDDEN: vec4<u32> = vec4<u32>(0xFFFFFFFFu);

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) vLocal: vec2<f32>,
};

@vertex
fn mainVertex(@location(0) aPosition: vec2<f32>) -> VSOutput {
  let mvp = globalUniforms.uProjectionMatrix *
    globalUniforms.uWorldTransformMatrix *
    localUniforms.uTransformMatrix;
  let clip = mvp * vec3<f32>(aPosition, 1.0);
  return VSOutput(vec4<f32>(clip.xy, 0.0, 1.0), aPosition);
}

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

@fragment
fn mainFragment(@location(0) vLocal: vec2<f32>) -> @location(0) vec4<f32> {
  let radius = lightUniforms.uReach.x;
  let point = vLocal * radius;
  let depth = length(point);
  if (depth >= radius) {
    return vec4<f32>(0.0, 0.0, 0.0, 1.0);
  }
  if (depth < MIN_DEPTH) {
    return vec4<f32>(lightUniforms.uLightColor, 1.0);
  }

  let toLight = -point / depth;
  let cone = lightUniforms.uCone;
  let aimed = dot(-toLight, cone.xy);
  var coneFactor: f32;
  if (cone.w > cone.z) {
    coneFactor = smoothstep(cone.z, cone.w, aimed);
  } else {
    coneFactor = select(0.0, 1.0, aimed >= cone.z);
  }
  if (coneFactor <= 0.0) {
    return vec4<f32>(0.0, 0.0, 0.0, 1.0);
  }

  let halfSize = max(lightUniforms.uReach.y, MIN_HALF_SIZE);
  let base = i32(lightUniforms.uEdgeSpan.x);
  let edges = i32(lightUniforms.uEdgeSpan.y);
  let discs = i32(lightUniforms.uEdgeSpan.z);
  let outlines = i32(lightUniforms.uEdgeSpan.w);
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
      return vec4<f32>(0.0, 0.0, 0.0, 1.0);
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
  return vec4<f32>(lightUniforms.uLightColor * (falloff * lit * coneFactor), 1.0);
}
`;

/** WebGPU shader stages, spelled the way `GPUShaderStage` spells them. */
const VERTEX_AND_FRAGMENT = 1 | 2;
const FRAGMENT_ONLY = 2;

/**
 * Bind-group layout for the three groups the shader declares. It replaces the
 * one Pixi reads out of the WGSL, which asks every texture for a filterable
 * sample type: the edge texture holds full-precision coordinates rather than
 * colour, and that format is sampled unfiltered.
 */
const GPU_LAYOUT: GPUBindGroupLayoutEntry[][] = [
  [
    {
      binding: 0,
      visibility: VERTEX_AND_FRAGMENT,
      buffer: { type: "uniform" },
    },
  ],
  [
    {
      binding: 0,
      visibility: VERTEX_AND_FRAGMENT,
      buffer: { type: "uniform" },
    },
  ],
  [
    {
      binding: 0,
      visibility: VERTEX_AND_FRAGMENT,
      buffer: { type: "uniform" },
    },
    {
      binding: 1,
      visibility: FRAGMENT_ONLY,
      texture: {
        sampleType: "unfilterable-float",
        viewDimension: "2d",
        multisampled: false,
      },
    },
  ],
];

let glProgram: GlProgram | undefined;
let gpuProgram: GpuProgram | undefined;
let quadGeometry: Geometry | undefined;

/** The unit quad every light's mesh is drawn from, in light radii. */
export function lightQuadGeometry(): Geometry {
  quadGeometry ??= new Geometry({
    attributes: {
      aPosition: {
        buffer: new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]),
        format: "float32x2",
        stride: 2 * 4,
        offset: 0,
      },
    },
    indexBuffer: new Uint32Array([0, 1, 2, 0, 2, 3]),
  });
  return quadGeometry;
}

/** Uniforms one light writes before its quad is drawn. */
export interface LightUniforms {
  /** RGB tint already scaled by the light's intensity. */
  uLightColor: Float32Array;
  /** Reach in world pixels: the light's radius, then the lamp's half-width. */
  uReach: Float32Array;
  /** Aim x, aim y, cosine where the cone ends, cosine where it is full. */
  uCone: Float32Array;
  /**
   * First texel of this light's run, then its edge count, its disc count, and
   * how many outlines the lamp reaches into.
   */
  uEdgeSpan: Float32Array;
}

/**
 * Build one light's shader over the shared edge texture. Both programs are
 * shared by every light in every scene, so a hundred lights compile one WebGL
 * program and one WebGPU module.
 */
export function createLightShader(edges: TextureSource): Shader {
  glProgram ??= GlProgram.from({
    vertex: VERTEX_GL,
    fragment: FRAGMENT_GL,
    name: "yage-lighting-shadow",
  });
  gpuProgram ??= new GpuProgram({
    vertex: { source: SHADER_WGSL, entryPoint: "mainVertex" },
    fragment: { source: SHADER_WGSL, entryPoint: "mainFragment" },
    gpuLayout: GPU_LAYOUT,
    name: "yage-lighting-shadow",
  });
  return new Shader({
    glProgram,
    gpuProgram,
    resources: {
      lightUniforms: {
        uLightColor: { value: new Float32Array(3), type: "vec3<f32>" },
        uReach: { value: new Float32Array(2), type: "vec2<f32>" },
        uCone: { value: new Float32Array(4), type: "vec4<f32>" },
        uEdgeSpan: { value: new Float32Array(4), type: "vec4<f32>" },
      },
      // The shader reads texels by index rather than sampling between them, so
      // it declares no sampler and the texture's own format never has to be a
      // filterable one.
      uEdges: edges,
    },
  });
}
