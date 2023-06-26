import { smootherstep } from './values'

export class Perlin {
  nodes: { x: number; y: number }[] = []
  size: number

  constructor(size = 10) {
    this.size = size
  }

  getRandomVector() {
    const theta = Math.random() * 2 * Math.PI
    return { x: Math.cos(theta), y: Math.sin(theta) }
  }

  getIntensity(x: number, y: number, vx: number, vy: number) {
    const distance = { x: x - vx, y: y - vy }
    const nodeIndex = vy * this.size + vx
    let node = this.nodes[nodeIndex]
    if (!node) {
      node = this.getRandomVector()
      this.nodes[nodeIndex] = node
    }
    return distance.x * node.x + distance.y * node.y
  }

  interpolate(a: number, b: number, t: number) {
    return a + t * (b - a)
  }

  reset(w = this.size) {
    this.size = w
    this.nodes = []
  }

  get(rx: number, ry: number) {
    const x = rx % this.size
    const y = ry % this.size
    const xf = Math.floor(x)
    const yf = Math.floor(y)

    const tl = this.getIntensity(x, y, xf, yf)
    const tr = this.getIntensity(x, y, xf + 1, yf)
    const bl = this.getIntensity(x, y, xf, yf + 1)
    const br = this.getIntensity(x, y, xf + 1, yf + 1)

    const smoothDx = smootherstep(x - xf)
    const smoothDy = smootherstep(y - yf)

    const xt = this.interpolate(tl, tr, smoothDx)
    const xb = this.interpolate(bl, br, smoothDx)
    const v = this.interpolate(xt, xb, smoothDy)

    return v
  }
}
