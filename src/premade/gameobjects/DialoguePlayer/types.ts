import { Game } from '../../../Game'

export type DialogueMessage = {
  text: string
  onEnter?: () => void
  onExit?: () => void
}

export type DialogueChoice = {
  next: string | null
  label: string
}

export type DialogueNode<Message extends DialogueMessage = DialogueMessage> = {
  id: string
  messages: Message[]
  next: string | DialogueChoice[] | null
  final?: boolean
}

export type Dialogue<Message extends DialogueMessage = DialogueMessage> = {
  data: {
    [key: string]: DialogueNode<Message>
  }
  initial: string
}
