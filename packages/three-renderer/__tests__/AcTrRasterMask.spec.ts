import { AcGePoint3d, type AcGiSubEntityTraits } from '@mlightcad/data-model'
import * as THREE from 'three'

import { AcTrRasterMask } from '../src/object/AcTrRasterMask'
import { getMaterialMetadata } from '../src/style/AcTrMaterialMetadata'
import { AcTrStyleManager } from '../src/style/AcTrStyleManager'
import { AcTrSubEntityTraitsUtil } from '../src/util'

type RasterMaskPrivateApi = {
  createNumericRegion(
    points: readonly AcGePoint3d[]
  ): [number, number][] | undefined
  createMaskTraits(traits: AcGiSubEntityTraits): AcGiSubEntityTraits
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

  it('forces raster mask traits to follow the canvas background', () => {
    const styleManager = new AcTrStyleManager()
    styleManager.currentBackgroundColor = 0x000000
    const traits = AcTrSubEntityTraitsUtil.createDefaultTraits()
    traits.layer = 'A-WIPEOUT'
    traits.color.setRGB(0xff, 0xff, 0x00)
    traits.rgbColor = 0xffff00
    traits.drawOrder = 0

    const maskTraits = privateMethods.createMaskTraits.call(
      privateMethods,
      traits
    )
    const material = styleManager.getFillMaterial(
      maskTraits
    ) as THREE.MeshBasicMaterial
    const metadata = getMaterialMetadata(material)

    expect(material.color.getHex()).toBe(0x000000)
    expect(metadata.isBackgroundFill).toBe(true)
    expect(metadata.drawOrder).toBe(-0.5)
    expect(traits.rgbColor).toBe(0xffff00)

    styleManager.currentBackgroundColor = 0xffffff
    expect(material.color.getHex()).toBe(0xffffff)
  })
})
