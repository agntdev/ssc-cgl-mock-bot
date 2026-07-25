/** A single clock seam for all exam timing. Tests may replace it when needed. */
let clock: () => Date = () => new Date();

export function now(): Date {
  return clock();
}

export function setClockForTests(next: (() => Date) | undefined): void {
  clock = next ?? (() => new Date());
}
