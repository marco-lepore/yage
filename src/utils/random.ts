export const getRandomValueInArray = <T>(array: T[], weights?: number[]): T => {
  if (weights && weights.length > 0) {
    const weightedArray = array.flatMap((v, index) => {
      return Array.from<T>({ length: weights[index] ?? 1 }).fill(v)
    })
    return weightedArray[Math.floor(Math.random() * weightedArray.length)]
  }

  return array[Math.floor(Math.random() * array.length)]
}
