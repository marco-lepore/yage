import { DialogueMessage } from './types'

export const textsToMessages = (arr: string[]): DialogueMessage[] =>
  arr.map((str) => ({ text: str }))

export const templateToMessages = (template: string) => {
  const texts = template.replace(/(\t| ){2,}/g, '').split('\n\n')
  const trimmedTexts = texts.map((text) => text.trim()).filter(Boolean)
  return textsToMessages(trimmedTexts)
}
