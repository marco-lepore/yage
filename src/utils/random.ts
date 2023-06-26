export const getRandomValueInArray = (arr: any[], weights?: number[]) => {
  if (weights && weights.length > 0) {
    const weightedArray = arr.flatMap((v, i) => {
      return Array(weights[i] ?? 1).fill(v)
    })
    return weightedArray[Math.floor(Math.random() * weightedArray.length)]
  }

  return arr[Math.floor(Math.random() * arr.length)]
}
