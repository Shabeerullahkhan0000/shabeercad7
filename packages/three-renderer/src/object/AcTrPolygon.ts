import {
  AcGeArea2d,
  AcGeGeometryUtil,
  AcGeIndexNode,
  AcGePoint2dLike,
  AcGiSubEntityTraits
} from '@mlightcad/data-model'
import { GeometryEpsilon, PolyBool, type Segments } from '@velipso/polybool'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { AcTrStyleManager } from '../style/AcTrStyleManager'
import { AcTrEntity } from './AcTrEntity'

type NumericPoint = [number, number]
type HatchBoundaryPoint = AcGePoint2dLike | readonly number[]

export class AcTrPolygon extends AcTrEntity {
  constructor(
    area: AcGeArea2d,
    traits: AcGiSubEntityTraits,
    styleManager: AcTrStyleManager
  ) {
    super(styleManager)

    let pointBoundaries: AcGePoint2dLike[][]
    let hierarchy: AcGeIndexNode
    try {
      pointBoundaries = area.getPoints(100)
      hierarchy = area.buildHierarchy()
    } catch (error) {
      this.reportHatchWarning(
        'invalid-boundary',
        'Failed to read hatch boundaries; this hatch was skipped.',
        { error: this.formatError(error) }
      )
      return
    }

    const geometries: THREE.BufferGeometry[] = []
    try {
      this.buildHatchGeometry(pointBoundaries, hierarchy, geometries)
    } catch (error) {
      this.reportHatchWarning(
        'invalid-boundary',
        'Failed to convert hatch boundaries; this hatch was skipped.',
        { error: this.formatError(error) }
      )
      return
    }

    const geometry =
      geometries.length > 0 ? mergeGeometries(geometries) : undefined

    if (!geometry || !this.hasRenderableGeometry(geometry)) {
      this.reportHatchWarning(
        'invalid-boundary',
        'Failed to convert hatch boundaries; this hatch was skipped.'
      )
      return
    }

    geometry.computeBoundingBox()
    this.box = geometry.boundingBox!

    this.addGradientPositionAttribute(geometry, traits)

    const gradientBounds = {
      minX: this.box.min.x,
      minY: this.box.min.y,
      maxX: this.box.max.x,
      maxY: this.box.max.y
    }
    const material = this.styleManager.getFillMaterial(
      traits,
      undefined,
      gradientBounds
    )
    this.add(new THREE.Mesh(geometry, material))
  }

  private addGradientPositionAttribute(
    geometry: THREE.BufferGeometry,
    traits: AcGiSubEntityTraits
  ) {
    if (!traits.fillType.gradient || !geometry.boundingBox) {
      return
    }

    const position = geometry.getAttribute('position')
    if (!position) {
      return
    }

    const box = geometry.boundingBox
    const centerX = (box.min.x + box.max.x) * 0.5
    const centerY = (box.min.y + box.max.y) * 0.5
    const halfWidth = Math.max((box.max.x - box.min.x) * 0.5, 1e-9)
    const halfHeight = Math.max((box.max.y - box.min.y) * 0.5, 1e-9)
    const values = new Float32Array(position.count * 2)

    for (let index = 0; index < position.count; index++) {
      values[index * 2] = (position.getX(index) - centerX) / halfWidth
      values[index * 2 + 1] = (position.getY(index) - centerY) / halfHeight
    }

    geometry.setAttribute(
      'gradientPosition',
      new THREE.BufferAttribute(values, 2)
    )
  }

  private buildHatchGeometry(
    pointBoundaries: AcGePoint2dLike[][],
    node: AcGeIndexNode,
    geometries: THREE.BufferGeometry[]
  ) {
    if (node.children.length === 0) {
      return
    }

    const noHoles: number[] = []
    const holes = new Map<number, number[]>()
    node.children.forEach(child => {
      if (child.children.length === 0) {
        noHoles.push(child.index)
      } else {
        holes.set(
          child.index,
          child.children.map(child => child.index)
        )
      }
    })

    noHoles.forEach(index => {
      const outer = this.createBoundaryVectors(pointBoundaries[index], 'outer')
      if (!outer) {
        return
      }

      this.createGeometry(new THREE.Shape(outer), geometries)
    })

    for (const [outerIndex, holeIndexes] of holes) {
      const outer = this.createBoundaryVectors(
        pointBoundaries[outerIndex],
        'outer'
      )
      if (!outer) {
        continue
      }

      const shape = new THREE.Shape(outer)
      const processedHoleIndexes = new Set<number>()
      const mergedHoleGroups = this.findIntersectHole(
        pointBoundaries,
        holeIndexes
      )

      mergedHoleGroups.forEach(group => {
        group.forEach(index => processedHoleIndexes.add(index))

        const mergedRegions = this.mergeIntersectingHoles(
          pointBoundaries,
          group
        )
        if (!mergedRegions) {
          return
        }

        mergedRegions.forEach(region => {
          const path = this.createPathFromRegion(region)
          if (path) {
            shape.holes.push(path)
          }
        })
      })

      holeIndexes.forEach(index => {
        if (processedHoleIndexes.has(index)) {
          return
        }

        const hole = this.createBoundaryVectors(pointBoundaries[index], 'hole')
        if (hole) {
          shape.holes.push(new THREE.Path(hole))
        }
      })

      this.createGeometry(shape, geometries)
    }

    node.children.forEach(child => {
      child.children.forEach(grandchild => {
        this.buildHatchGeometry(pointBoundaries, grandchild, geometries)
      })
    })
  }

  private createGeometry(
    shape: THREE.Shape,
    geometries: THREE.BufferGeometry[]
  ) {
    try {
      const geom = new THREE.ShapeGeometry(shape)
      if (!this.hasRenderableGeometry(geom)) {
        this.reportHatchWarning(
          'triangulation-failed',
          'A hatch boundary produced no triangles and was skipped.'
        )
        geom.dispose()
        return
      }

      if (geom.hasAttribute('uv')) {
        geom.deleteAttribute('uv')
      }
      if (geom.hasAttribute('normal')) {
        geom.deleteAttribute('normal')
      }
      geometries.push(geom)
    } catch (error) {
      this.reportHatchWarning(
        'triangulation-failed',
        'A hatch boundary could not be triangulated and was skipped.',
        { error: this.formatError(error) }
      )
    }
  }

  private findIntersectHole(
    pointBoundaries: AcGePoint2dLike[][],
    indexArr: number[]
  ) {
    const parent = new Map<number, number>()
    indexArr.forEach(index => parent.set(index, index))

    const find = (index: number): number => {
      const current = parent.get(index)
      if (current == null || current === index) {
        return index
      }

      const root = find(current)
      parent.set(index, root)
      return root
    }

    const union = (a: number, b: number) => {
      const rootA = find(a)
      const rootB = find(b)
      if (rootA !== rootB) {
        parent.set(rootB, rootA)
      }
    }

    for (let i = 0; i < indexArr.length; i++) {
      for (let j = i + 1; j < indexArr.length; j++) {
        const firstIndex = indexArr[i]
        const secondIndex = indexArr[j]
        const first = pointBoundaries[firstIndex]
        const second = pointBoundaries[secondIndex]

        if (!this.isBoundaryUsable(first) || !this.isBoundaryUsable(second)) {
          continue
        }

        try {
          if (AcGeGeometryUtil.isPolygonIntersect(first, second)) {
            union(firstIndex, secondIndex)
          }
        } catch (error) {
          this.reportHatchWarning(
            'hole-merge-failed',
            'Failed to test intersecting hatch holes; the affected holes were simplified.',
            { error: this.formatError(error) }
          )
        }
      }
    }

    const groups = new Map<number, number[]>()
    indexArr.forEach(index => {
      const root = find(index)
      const group = groups.get(root) ?? []
      group.push(index)
      groups.set(root, group)
    })

    return [...groups.values()].filter(group => group.length > 1)
  }

  private mergeIntersectingHoles(
    pointBoundaries: AcGePoint2dLike[][],
    holeIndexes: number[]
  ) {
    const regions = holeIndexes
      .map(index => this.createNumericRegion(pointBoundaries[index]))
      .filter((region): region is NumericPoint[] => !!region)

    if (regions.length < 2) {
      return undefined
    }

    const epsilon = this.calculateMergeEpsilon(regions)
    const polybool = new PolyBool(new GeometryEpsilon(epsilon))

    try {
      let mergedSegments: Segments = polybool.segments({
        regions: [regions[0]],
        inverted: false
      })

      for (let index = 1; index < regions.length; index++) {
        const nextSegments = polybool.segments({
          regions: [regions[index]],
          inverted: false
        })
        const combined = polybool.combine(mergedSegments, nextSegments)
        mergedSegments = polybool.selectUnion(combined)
      }

      const mergedHoles = polybool.polygon(mergedSegments)
      if (mergedHoles.regions.length === 0) {
        this.reportHatchWarning(
          'hole-merge-empty',
          'Intersecting hatch holes collapsed during merge; the affected holes were simplified.',
          { epsilon, holeCount: holeIndexes.length }
        )
        return undefined
      }

      return mergedHoles.regions
    } catch (error) {
      this.reportHatchWarning(
        'hole-merge-failed',
        'Failed to merge intersecting hatch holes; the affected holes were simplified.',
        {
          error: this.formatError(error),
          epsilon,
          holeCount: holeIndexes.length
        }
      )
      return undefined
    }
  }

  private createBoundaryVectors(
    points: HatchBoundaryPoint[] | undefined,
    role: 'outer' | 'hole'
  ) {
    const region = this.createNumericRegion(points)
    if (!region) {
      this.reportHatchWarning(
        'invalid-boundary',
        `Invalid hatch ${role} boundary was skipped.`,
        { pointCount: points?.length ?? 0 }
      )
      return undefined
    }

    return region.map(point => new THREE.Vector2(point[0], point[1]))
  }

  private createPathFromRegion(region: number[][]) {
    const points = this.createNumericRegion(region)
    if (!points) {
      this.reportHatchWarning(
        'invalid-boundary',
        'Merged hatch hole boundary was invalid and skipped.',
        { pointCount: region.length }
      )
      return undefined
    }

    return new THREE.Path(
      points.map(point => new THREE.Vector2(point[0], point[1]))
    )
  }

  private createNumericRegion(
    points: readonly HatchBoundaryPoint[] | undefined
  ): NumericPoint[] | undefined {
    if (!points || points.length < 3) {
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

  private isBoundaryUsable(points: HatchBoundaryPoint[] | undefined) {
    return !!this.createNumericRegion(points)
  }

  private toNumericPoint(point: HatchBoundaryPoint): NumericPoint | undefined {
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

  private calculateMergeEpsilon(regions: NumericPoint[][]) {
    const points = regions.flat()
    const bounds = this.calculateBounds(points)
    const scale = Math.max(bounds.width, bounds.height, 1)
    return Math.max(1e-7, Math.min(scale * 1e-6, 1e-3))
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
      minX,
      minY,
      maxX,
      maxY,
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

  private reportHatchWarning(
    kind: Parameters<
      AcTrStyleManager['reportHatchRenderingWarning']
    >[0]['kind'],
    message: string,
    details?: Record<string, unknown>
  ) {
    this.styleManager.reportHatchRenderingWarning({ kind, message, details })
  }

  private formatError(error: unknown) {
    return error instanceof Error ? error.message : String(error)
  }
}
