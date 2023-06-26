import { EventQueue, Vector2, World } from '@dimforge/rapier2d'
import { RapierBodyComponent } from '../components/RapierBodyComponent'

export class Rapier {
  world: World
  eventQueue = new EventQueue(true)
  pixelToMeterRatio = 50

  constructor(gravity: Vector2 = { x: 0, y: 9.8 }, pixelToMeterRatio?: number) {
    this.world = new World(gravity)
    this.pixelToMeterRatio = pixelToMeterRatio ?? this.pixelToMeterRatio
  }

  gameTimeMS = 0
  addGameTime(elapsedMS: number) {
    this.gameTimeMS += elapsedMS
  }

  prevSimulationTime = 0
  simulationTime = 0
  step(
    timestepMS: number,
    beforeCallback?: (timestepMS: number) => void,
    afterCallback?: (timestepMS: number) => void,
  ) {
    beforeCallback && beforeCallback(timestepMS)
    this.world.timestep = timestepMS / 1000
    this.world.step(this.eventQueue)
    this.eventQueue.drainCollisionEvents((handle1, handle2, started) => {
      const comp1 = RapierBodyComponent.colliderComponentMap.get(handle1)
      const comp2 = RapierBodyComponent.colliderComponentMap.get(handle2)
      const collider1 = this.world.getCollider(handle1)
      const collider2 = this.world.getCollider(handle2)
      comp1?.handleCollision(collider1, collider2, started)
      comp2?.handleCollision(collider2, collider1, started)
    })
    this.prevSimulationTime = this.simulationTime
    this.simulationTime += timestepMS
    afterCallback && afterCallback(timestepMS)
  }

  fixedStep = 1000 / 60

  simulate(
    beforeCallback?: (timestepMS: number) => void,
    afterCallback?: (timestepMS: number) => void,
  ) {
    while (this.gameTimeMS > this.simulationTime) {
      this.step(this.fixedStep, beforeCallback, afterCallback)
    }
  }

  destroy(): void {}
}
