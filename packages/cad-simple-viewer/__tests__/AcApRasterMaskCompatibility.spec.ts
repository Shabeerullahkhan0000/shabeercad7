import {
  AcCmColor,
  AcCmTransparency,
  AcDbWipeout,
  AcGePoint2d,
  AcGePoint3d,
  AcGiEntity,
  AcGiLineWeight,
  AcGiRenderer,
  AcGiSubEntityTraits
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

  test('uses direct raster mask rendering when the renderer supports it', () => {
    const wipeout = createUnitWipeout(50, 50)
    const maskEntity = {} as AcGiEntity
    const capturedTraits: {
      isForeground?: boolean
      rgbColor?: number
      drawOrder?: number
    } = {}
    const renderer = {
      subEntityTraits: createTraits(),
      rasterMask: jest.fn(function rasterMask(this: AcGiRenderer) {
        capturedTraits.isForeground = this.subEntityTraits.color.isForeground
        capturedTraits.rgbColor = this.subEntityTraits.rgbColor
        capturedTraits.drawOrder = this.subEntityTraits.drawOrder
        return maskEntity
      }),
      area: jest.fn()
    } as unknown as AcGiRenderer & {
      rasterMask: jest.Mock<AcGiEntity, [AcGePoint3d[]]>
      area: jest.Mock
    }

    const result = wipeout.subWorldDraw(renderer)

    expect(result).toBe(maskEntity)
    expect(renderer.rasterMask).toHaveBeenCalledTimes(1)
    expect(renderer.rasterMask.mock.calls[0][0]).toHaveLength(5)
    expect(renderer.area).not.toHaveBeenCalled()
    expect(capturedTraits.isForeground).toBe(true)
    expect(capturedTraits.rgbColor).toBe(0xffffff)
    expect(capturedTraits.drawOrder).toBe(-0.5)
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

function createTraits(): AcGiSubEntityTraits {
  return {
    color: new AcCmColor(),
    rgbColor: 0xffffff,
    lineType: {
      type: 'ByLayer',
      name: 'Continuous',
      standardFlag: 0,
      description: 'Solid line',
      totalPatternLength: 0
    },
    lineTypeScale: 1,
    lineWeight: AcGiLineWeight.ByLayer,
    fillType: {
      solidFill: true,
      patternAngle: 0,
      definitionLines: []
    },
    transparency: new AcCmTransparency(),
    thickness: 0,
    layer: '0',
    drawOrder: 0
  }
}
