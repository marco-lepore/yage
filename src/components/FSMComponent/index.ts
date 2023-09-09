import {
  AnyStateMachine,
  ContextFrom,
  interpret,
  InterpreterFrom,
  StateFrom,
} from 'xstate'
import { GameObject } from '../../GameObject'
import { Component } from '../BaseComponent'

export class FSMComponent<
  Parent extends GameObject = GameObject,
  Machine extends AnyStateMachine = AnyStateMachine,
> extends Component<Parent> {
  name = 'FSMComponent'
  service: InterpreterFrom<Machine>
  state: StateFrom<Machine>

  constructor(
    parent: Parent,
    machine: Machine,
    initialContext?: ContextFrom<Machine>,
  ) {
    super(parent)
    this.service = interpret(
      machine.withContext(initialContext),
    ) as InterpreterFrom<Machine>
    this.state = this.service.getSnapshot() as StateFrom<Machine>
  }

  onAdded(): void {
    this.service.start()
  }

  onRemoved(): void {
    this.service.stop()
  }

  onBeforeFixedTick(dt: number): void {
    super.onBeforeFixedTick(dt)
    this.state = this.service.getSnapshot() as StateFrom<Machine>
  }
}
