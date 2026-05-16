import {
  AcDbWipeout,
  AcGePoint2d,
  AcGePoint3d
} from '@mlightcad/data-model'

import { installRasterMaskCompatibilityPatch } from '../src/app/AcApRasterMaskCompatibility'

type WipeoutWithBoundaryPath = AcDbWipeout & {
  boundaryPath(): AcGePoint3d[]
}

describe('AcApRasterMaskCompatibility', () => {
  beforeAll(() => {
    installRasterMaskCompatibilityPatch()
  })

  test('maps 1x1 wipeout clip vertices around the insertion point', () => {
    const wipeout = createUnitWipeout(50, 50)

    const points = getBoundaryPath(wipeout)

    expect(points[0].x).toBeCloseTo(-25)
    expect(points[0].y).toBeCloseTo(-25)
    expect(points[1].x).toBeCloseTo(25)
    expect(points[1].y).toBeCloseTo(-25)
    expect(points[2].x).toBeCloseTo(25)
    expect(points[2].y).toBeCloseTo(25)
    expect(points[3].x).toBeCloseTo(-25)
    expect(points[3].y).toBeCloseTo(25)
    expect(points[4].x).toBeCloseTo(points[0].x)
    expect(points[4].y).toBeCloseTo(points[0].y)
  })

  test('applies raster rotation from the U vector orientation', () => {
    const wipeout = createUnitWipeout(100, 50)
    wipeout.position = new AcGePoint3d(10, 20, 0)
    wipeout.rotation = Math.PI / 2

    const points = getBoundaryPath(wipeout)

    expect(points[0].x).toBeCloseTo(35)
    expect(points[0].y).toBeCloseTo(-30)
    expect(points[1].x).toBeCloseTo(35)
    expect(points[1].y).toBeCloseTo(70)
    expect(points[2].x).toBeCloseTo(-15)
    expect(points[2].y).toBeCloseTo(70)
    expect(points[3].x).toBeCloseTo(-15)
    expect(points[3].y).toBeCloseTo(-30)
  })
})

function createUnitWipeout(width: number, height: number) {
  const wipeout = new AcDbWipeout()
  wipeout.position = new AcGePoint3d(0, 0, 0)
  wipeout.width = width
  wipeout.height = height
  wipeout.imageSize = new AcGePoint2d(1, 1)
  wipeout.isClipped = true
  wipeout.clipBoundary = [
    new AcGePoint2d(-0.5, -0.5),
    new AcGePoint2d(0.5, -0.5),
    new AcGePoint2d(0.5, 0.5),
    new AcGePoint2d(-0.5, 0.5)
  ]
  return wipeout
}

function getBoundaryPath(wipeout: AcDbWipeout) {
  return (wipeout as WipeoutWithBoundaryPath).boundaryPath()
}
