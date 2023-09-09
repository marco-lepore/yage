export class Node {
  private _parent: Node | null
  private _children: Node[]

  get parent() {
    return this._parent as Node | null
  }

  get children() {
    const b = 1
    return this._children as readonly Node[]
  }

  findChildByClass<N extends Node>(ctor: { new (): N }): N | null {
    for (const node of this.children) {
      if (node instanceof ctor) {
        return node
      }
    }
    return null
  }

  addChild(node: Node) {
    if (node._parent) {
      throw new Error('node already has a parent')
    }
    this._children.push(node)
    node._parent = this
  }

  removeChild(node: Node) {
    const index = this._children.findIndex((n) => n === node)
    if (index === -1) {
      throw new Error('node is not a child')
    }
    this._children.splice(index, 1)
    node._parent = null
  }

  reparent(newParent: Node) {
    if (!this._parent) {
      throw new Error('node has no parent')
    }
    this._parent.removeChild(this)
    newParent.addChild(this)
  }
}
