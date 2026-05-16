import { AcGePoint3d } from '@mlightcad/data-model'

import { AcTrRasterMask } from '../src/object/AcTrRasterMask'

type RasterMaskPrivateApi = {
  createNumericRegion(
    points: readonly AcGePoint3d[]
  ): [number, number][] | undefined
}

const privateMethods =
  AcTrRasterMask.prototype as unknown as RasterMaskPrivateApi

describe('AcTrRasterMask', () => {
  it('cleans closed mask boundaries before triangulation', () => {
    const region = privateMethods.createNumericRegion.call(privateMethods, [
      new AcGePoint3d(0, 0, 0),
      new AcGePoint3d(10, 0, 0),
      new AcGePoint3d(10, 10, 0),
      new AcGePoint3d(0, 10, 0),
      new AcGePoint3d(0, 0, 0)
    ])

    expect(region).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10]
    ])
  })

  it('rejects degenerate mask boundaries defensively', () => {
    const region = privateMethods.createNumericRegion.call(privateMethods, [
      new AcGePoint3d(0, 0, 0),
      new AcGePoint3d(1, 0, 0),
      new AcGePoint3d(2, 0, 0)
    ])

    expect(region).toBeUndefined()
  })
})
