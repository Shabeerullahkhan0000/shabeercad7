import {
  AcCmColor,
  AcCmTransparency,
  AcGePoint2dLike,
  AcGePoint3dLike,
  AcGiSubEntityTraits
} from '@mlightcad/data-model'
import * as THREE from 'three'

import { AcTrStyleManager } from '../style/AcTrStyleManager'
import { AcTrEntity } from './AcTrEntity'

type NumericPoint = [number, number]
type RasterMaskPoint = AcGePoint2dLike | AcGePoint3dLike | readonly number[]
const RASTER_MASK_DRAW_ORDER = -0.5

/**
 * Direct render path for WIPEOUT/raster mask polygons.
 *
 * Wipeouts are solid cover masks, not hatches. Sending them through the
 * hatch boundary hierarchy/boolean pipeline can collapse valid mask
 * boundaries into invalid hatch loops, which makes masked hatch areas leak
 * through. This object triangulates the one mask outline directly.
 */
export class AcTrRasterMask extends AcTrEntity {
  constructor(
    points: RasterMaskPoint[],
    traits: AcGiSubEntityTraits,
    styleManager: AcTrStyleManager
  ) {
    super(styleManager)

    const region = this.createNumericRegion(points)
    if (!region) {
      this.reportInvalidRasterMask(points.length)
      return
    }

    if (this.signedArea(region) < 0) {
      region.reverse()
    }

    let geometry: THREE.ShapeGeometry
    try {
      const shape = new THREE.Shape(
        region.map(point => new THREE.Vector2(point[0], point[1]))
      )
      geometry = new THREE.ShapeGeometry(shape)
    } catch (error) {
      this.reportInvalidRasterMask(points.length, error)
      return
    }

    if (!this.hasRenderableGeometry(geometry)) {
      geometry.dispose()
      this.reportInvalidRasterMask(points.length)
      return
    }

    if (geometry.hasAttribute('uv')) {
      geometry.deleteAttribute('uv')
    }
    if (geometry.hasAttribute('normal')) {
      geometry.deleteAttribute('normal')
    }

    geometry.computeBoundingBox()
    this.box = geometry.boundingBox!

    const gradientBounds = {
      minX: this.box.min.x,
      minY: this.box.min.y,
      maxX: this.box.max.x,
      maxY: this.box.max.y
    }
    const maskTraits = this.createMaskTraits(traits)
    const material = this.styleManager.getFillMaterial(
      maskTraits,
      undefined,
      gradientBounds
    )
    this.add(new THREE.Mesh(geometry, material))
  }

  private createMaskTraits(traits: AcGiSubEntityTraits): AcGiSubEntityTraits {
    return {
      ...traits,
      color: new AcCmColor().setForeground(),
      rgbColor: 0xffffff,
      fillType: {
        solidFill: true,
        patternAngle: 0,
        definitionLines: []
      },
      transparency: new AcCmTransparency(),
      drawOrder: RASTER_MASK_DRAW_ORDER
    }
  }

  private createNumericRegion(points: readonly RasterMaskPoint[]) {
    if (points.length < 3) {
      return undefined
    }

    const numericPoints: NumericPoint[] = []
    points.forEach(point => {
      const numericPoint = this.toNumericPoint(point)
      if (numericPoint) {
        numericPoints.push(numericPoint)
      }
    })

    if (numericPoints.length < 3) {
      return undefined
    }

    const epsilon = this.calculatePointEpsilon(numericPoints)
    const epsilonSq = epsilon * epsilon
    const cleaned: NumericPoint[] = []

    numericPoints.forEach(point => {
      const previous = cleaned[cleaned.length - 1]
      if (!previous || this.distanceSq(previous, point) > epsilonSq) {
        cleaned.push(point)
      }
    })

    if (
      cleaned.length > 1 &&
      this.distanceSq(cleaned[0], cleaned[cleaned.length - 1]) <= epsilonSq
    ) {
      cleaned.pop()
    }

    if (cleaned.length < 3) {
      return undefined
    }

    if (Math.abs(this.signedArea(cleaned)) <= epsilonSq) {
      return undefined
    }

    return cleaned
  }

  private toNumericPoint(point: RasterMaskPoint): NumericPoint | undefined {
    let x: number
    let y: number
    if (Array.isArray(point)) {
      const tuple = point as readonly number[]
      x = tuple[0]
      y = tuple[1]
    } else {
      const pointLike = point as AcGePoint2dLike
      x = pointLike.x
      y = pointLike.y
    }

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return undefined
    }

    return [x, y]
  }

  private hasRenderableGeometry(geometry: THREE.BufferGeometry) {
    const position = geometry.getAttribute('position')
    if (!position || position.count === 0) {
      return false
    }

    const index = geometry.getIndex()
    return !index || index.count > 0
  }

  private calculatePointEpsilon(points: NumericPoint[]) {
    const bounds = this.calculateBounds(points)
    const scale = Math.max(bounds.width, bounds.height, 1)
    return Math.max(scale * 1e-10, 1e-9)
  }

  private calculateBounds(points: NumericPoint[]) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    points.forEach(point => {
      minX = Math.min(minX, point[0])
      minY = Math.min(minY, point[1])
      maxX = Math.max(maxX, point[0])
      maxY = Math.max(maxY, point[1])
    })

    return {
      width: maxX - minX,
      height: maxY - minY
    }
  }

  private signedArea(points: NumericPoint[]) {
    let area = 0
    for (let index = 0; index < points.length; index++) {
      const current = points[index]
      const next = points[(index + 1) % points.length]
      area += current[0] * next[1] - next[0] * current[1]
    }
    return area * 0.5
  }

  private distanceSq(a: NumericPoint, b: NumericPoint) {
    const dx = a[0] - b[0]
    const dy = a[1] - b[1]
    return dx * dx + dy * dy
  }

  private reportInvalidRasterMask(pointCount: number, error?: unknown) {
    const details: Record<string, unknown> = { pointCount }
    if (error) {
      details.error = error instanceof Error ? error.message : String(error)
    }

    this.styleManager.reportHatchRenderingWarning({
      kind: 'invalid-boundary',
      message: 'Invalid raster mask boundary was skipped.',
      details
    })
  }
}
