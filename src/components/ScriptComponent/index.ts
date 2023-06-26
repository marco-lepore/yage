import { GameObject } from '../../GameObject'
import { Component } from '../BaseComponent'

export class ScriptComponent<
  Parent extends GameObject = GameObject,
> extends Component<Parent> {
  name = 'ScriptComponent'
}
