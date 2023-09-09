export class FlagTester {
  constructor(private value: number = 0) {}

  public has(...keys: number[]): boolean {
    const allKeys = keys.reduce((previous, k) => (previous |= k), 0)
    return (this.value & allKeys) === allKeys
  }
}
