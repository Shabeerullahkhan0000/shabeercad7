import {
  AcCmColor,
  AcCmTransparency,
  AcDbRasterImage,
  AcDbWipeout,
  AcGeArea2d,
  AcGePoint2d,
  AcGePoint3d,
  AcGePolyline2d,
  AcGiEntity,
  AcGiRenderer,
  AcGiSubEntityTraits,
  log
} from '@mlightcad/data-model'

type Point2dLike = { x?: number; y?: number }
type Point3dLike = { x?: number; y?: number; z?: number }
type PatchMarkerBag = { [key: symbol]: boolean | undefined }

type RasterImageWithBoundaryPath = AcDbRasterImage & {
  boundaryPath(): AcGePoint3d[]
}

type WipeoutWithSubWorldDraw = AcDbWipeout & {
  subWorldDraw(renderer: AcGiRenderer): AcGiEntity
}

type RasterMaskConverter = PatchMarkerBag & {
  parse?: (...args: unknown[]) => unknown
}

type ParsedDrawingLike = {
  entities?: ParsedEntityLike[]
  blocks?: Record<string, { entities?: ParsedEntityLike[] }>
}

type ParsedEntityLike = {
  type?: string
  clippingBoundaryPath?: Point2dLike[]
  boundary?: Point2dLike[]
}

const PATCH_MARKER = Symbol.for('shabeercad.raster-mask-compatibility')
const WIPEOUT_DRAW_ORDER = -0.5
const WHITE = 0xffffff

let hasReportedInvalidRasterBoundary = false

/**
 * Installs compatibility fixes for raster-image and wipeout entities emitted by
 * @mlightcad/data-model 1.7.x. Real architectural drawings often use WIPEOUT
 * entities as white masks behind sanitary/furniture blocks; the upstream model
 * currently treats them as generic hatch-like areas and misses several guards.
 */
export function installRasterMaskCompatibilityPatch() {
  patchRasterImageBoundaryPath()
  patchWipeoutWorldDraw()
}

export function patchRasterMaskConverter(converter: unknown) {
  const target = converter as RasterMaskConverter
  if (target[PATCH_MARKER] || typeof target.parse !== 'function') {
    return
  }

  const originalParse = target.parse
  target.parse = async function parseWithRasterMaskGuards(
    this: RasterMaskConverter,
    ...args: unknown[]
  ) {
    const result = await originalParse.apply(this, args)
    normalizeParsedRasterMaskPayloads(result)
    return result
  }
  target[PATCH_MARKER] = true
}

function patchRasterImageBoundaryPath() {
  const rasterImageCtor = AcDbRasterImage as unknown as
    | { prototype?: RasterImageWithBoundaryPath & PatchMarkerBag }
    | undefined
  const prototype = rasterImageCtor?.prototype

  if (!prototype?.boundaryPath) {
    return
  }

  if (prototype[PATCH_MARKER]) {
    return
  }

  const originalBoundaryPath = prototype.boundaryPath
  prototype.boundaryPath = function boundaryPathPatched() {
    const points = buildRasterBoundary(this)
    if (points.length >= 4) {
      return points
    }

    reportInvalidRasterBoundary()
    return originalBoundaryPath.call(this)
  }

  prototype[PATCH_MARKER] = true
}

function patchWipeoutWorldDraw() {
  const wipeoutCtor = AcDbWipeout as unknown as
    | { prototype?: WipeoutWithSubWorldDraw & PatchMarkerBag }
    | undefined
  const prototype = wipeoutCtor?.prototype

  if (!prototype?.subWorldDraw) {
    return
  }

  if (prototype[PATCH_MARKER]) {
    return
  }

  const originalSubWorldDraw = prototype.subWorldDraw
  prototype.subWorldDraw = function subWorldDrawPatched(
    renderer: AcGiRenderer
  ) {
    const points = buildRasterBoundary(this)
    if (points.length < 4) {
      reportInvalidRasterBoundary()
      return originalSubWorldDraw.call(this, renderer)
    }

    const area = new AcGeArea2d()
    area.add(new AcGePolyline2d(points))

    const traits = renderer.subEntityTraits
    const previousTraits = snapshotTraits(traits)
    applyWipeoutTraits(traits)

    try {
      return renderer.area(area)
    } finally {
      restoreTraits(traits, previousTraits)
    }
  }

  prototype[PATCH_MARKER] = true
}

function buildRasterBoundary(image: AcDbRasterImage) {
  const width = positiveOrFallback(image.width, 0)
  const height = positiveOrFallback(image.height, 0)
  const position = image.position

  if (width <= 0 || height <= 0 || !isFinitePoint3d(position)) {
    return []
  }

  const clipBoundary =
    image.isClipped && image.clipBoundary.length >= 3
      ? image.clipBoundary.filter(isFinitePoint2d)
      : []

  const localPoints =
    clipBoundary.length >= 3
      ? mapClipBoundaryToLocalPoints(clipBoundary, image, width, height)
      : [
          new AcGePoint2d(0, 0),
          new AcGePoint2d(width, 0),
          new AcGePoint2d(width, height),
          new AcGePoint2d(0, height)
        ]

  const rotation = finiteOrDefault(image.rotation, 0)
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const points = localPoints.map(point => {
    const x = position.x + point.x * cos - point.y * sin
    const y = position.y + point.x * sin + point.y * cos
    return new AcGePoint3d(x, y, position.z)
  })

  return ensureClosed(points)
}

function normalizeParsedRasterMaskPayloads(result: unknown) {
  if (result == null || typeof result !== 'object') {
    return
  }

  const maybeResult = result as { model?: ParsedDrawingLike }
  const model = maybeResult.model ?? (result as ParsedDrawingLike)
  normalizeEntities(model.entities)

  if (model.blocks) {
    Object.values(model.blocks).forEach(block => {
      normalizeEntities(block.entities)
    })
  }
}

function normalizeEntities(entities: ParsedEntityLike[] | undefined) {
  if (!Array.isArray(entities)) {
    return
  }

  entities.forEach(entity => {
    if (entity.type === 'IMAGE' && !Array.isArray(entity.clippingBoundaryPath)) {
      entity.clippingBoundaryPath = []
    } else if (entity.type === 'WIPEOUT' && !Array.isArray(entity.boundary)) {
      entity.boundary = []
    }
  })
}

function mapClipBoundaryToLocalPoints(
  clipBoundary: AcGePoint2d[],
  image: AcDbRasterImage,
  width: number,
  height: number
) {
  const minX = Math.min(...clipBoundary.map(point => point.x))
  const minY = Math.min(...clipBoundary.map(point => point.y))
  const maxX = Math.max(...clipBoundary.map(point => point.x))
  const maxY = Math.max(...clipBoundary.map(point => point.y))
  const spanX = maxX - minX
  const spanY = maxY - minY

  if (spanX <= 0 || spanY <= 0) {
    return []
  }

  const scaleX =
    image.imageSize.x > 1 && spanX > 1 ? width / image.imageSize.x : width
  const scaleY =
    image.imageSize.y > 1 && spanY > 1 ? height / image.imageSize.y : height

  return clipBoundary.map(
    point => new AcGePoint2d((point.x - minX) * scaleX, (point.y - minY) * scaleY)
  )
}

function applyWipeoutTraits(traits: AcGiSubEntityTraits) {
  traits.color = new AcCmColor().setRGBValue(WHITE)
  traits.rgbColor = WHITE
  traits.fillType = {
    solidFill: true,
    patternAngle: 0,
    definitionLines: []
  }
  traits.transparency = new AcCmTransparency()
  traits.drawOrder = WIPEOUT_DRAW_ORDER
}

function snapshotTraits(traits: AcGiSubEntityTraits): AcGiSubEntityTraits {
  return {
    ...traits,
    color: traits.color.clone(),
    transparency: traits.transparency.clone(),
    fillType: {
      ...traits.fillType,
      backgroundColor: traits.fillType.backgroundColor?.clone(),
      definitionLines: [...(traits.fillType.definitionLines ?? [])],
      gradient: traits.fillType.gradient
        ? { ...traits.fillType.gradient }
        : undefined
    }
  }
}

function restoreTraits(
  traits: AcGiSubEntityTraits,
  previousTraits: AcGiSubEntityTraits
) {
  Object.assign(traits, previousTraits)
}

function ensureClosed(points: AcGePoint3d[]) {
  if (points.length === 0) {
    return points
  }

  const first = points[0]
  const last = points[points.length - 1]
  if (
    Math.abs(first.x - last.x) > 1e-9 ||
    Math.abs(first.y - last.y) > 1e-9 ||
    Math.abs(first.z - last.z) > 1e-9
  ) {
    points.push(first.clone())
  }

  return points
}

function finiteOrDefault(value: number | undefined, fallback: number) {
  return Number.isFinite(value) ? value! : fallback
}

function positiveOrFallback(value: number | undefined, fallback: number) {
  return Number.isFinite(value) && value! > 0 ? value! : fallback
}

function isFinitePoint2d(point: Point2dLike | undefined): point is {
  x: number
  y: number
} {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y)
}

function isFinitePoint3d(point: Point3dLike | undefined): point is {
  x: number
  y: number
  z: number
} {
  return (
    Number.isFinite(point?.x) &&
    Number.isFinite(point?.y) &&
    Number.isFinite(point?.z)
  )
}

function reportInvalidRasterBoundary() {
  if (hasReportedInvalidRasterBoundary) {
    return
  }

  hasReportedInvalidRasterBoundary = true
  log.debug(
    '[AcTrRasterMask] Invalid raster/wipeout boundary was skipped or downgraded.'
  )
}
