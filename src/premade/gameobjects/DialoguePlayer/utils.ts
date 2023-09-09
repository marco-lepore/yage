import { DialogueMessage } from './types'

export const textsToMessages = (array: string[]): DialogueMessage[] =>
  array.map((string_) => ({ text: string_ }))

export const templateToMessages = (template: string) => {
  // eslint-disable-next-line unicorn/prefer-string-replace-all
  const texts = template.replace(/(\t| ){2,}/g, '').split('\n\n')
  const trimmedTexts = texts.map((text) => text.trim()).filter(Boolean)
  return textsToMessages(trimmedTexts)
}
