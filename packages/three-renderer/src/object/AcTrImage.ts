import { AcGePoint3dLike, AcGiImageStyle, log } from '@mlightcad/data-model'
import * as THREE from 'three'

import { AcTrStyleManager } from '../style/AcTrStyleManager'
import { AcTrEntity } from './AcTrEntity'

export class AcTrImage extends AcTrEntity {
  constructor(
    blob: Blob,
    style: AcGiImageStyle,
    styleManager: AcTrStyleManager
  ) {
    super(styleManager)
    const boundary = this.createBoundaryVectors(style.boundary)
    if (!boundary) {
      log.debug(
        '[AcTrImage] Invalid image boundary; raster image was skipped.'
      )
      return
    }

    const blobUrl = URL.createObjectURL(blob)
    const textureLoader = new THREE.TextureLoader()
    const texture = textureLoader.load(
      blobUrl,
      () => URL.revokeObjectURL(blobUrl),
      undefined,
      () => URL.revokeObjectURL(blobUrl)
    )
    texture.colorSpace = THREE.SRGBColorSpace
    const material = new THREE.MeshBasicMaterial({
      side: THREE.DoubleSide,
      map: texture
    })

    const shape = new THREE.Shape(boundary)
    const geometry = new THREE.ShapeGeometry(shape)
    if (!geometry.getAttribute('position')?.count) {
      geometry.dispose()
      return
    }

    this.generateUVs(geometry)
    geometry.computeBoundingBox()
    if (geometry.boundingBox) {
      this.box = geometry.boundingBox
    }

    const mesh = new THREE.Mesh(geometry, material)
    this.add(mesh)
  }

  /**
   * Generate UVs for the specified THREE.ShapeGeometry instance. THREE.ShapeGeometry does not automatically
   * generate UVs. To apply textures, we need to manually generate the UV coordinates for your shape.
   * @param geometry Input geometry to generate UVs
   */
  protected generateUVs(geometry: THREE.ShapeGeometry) {
    const position = geometry.attributes.position.array
    const uv = new Float32Array((position.length / 3) * 2)

    const minX = Math.min(...position.filter((_, i) => i % 3 === 0))
    const maxX = Math.max(...position.filter((_, i) => i % 3 === 0))
    const minY = Math.min(...position.filter((_, i) => i % 3 === 1))
    const maxY = Math.max(...position.filter((_, i) => i % 3 === 1))

    const width = maxX - minX
    const height = maxY - minY

    for (let i = 0; i < position.length; i += 3) {
      const x = position[i]
      const y = position[i + 1]
      uv[(i / 3) * 2] = width > 0 ? (x - minX) / width : 0
      uv[(i / 3) * 2 + 1] = height > 0 ? (y - minY) / height : 0
    }

    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  }

  private createBoundaryVectors(points: AcGePoint3dLike[] | undefined) {
    if (!Array.isArray(points)) {
      return undefined
    }

    const vectors = points
      .filter(
        point => Number.isFinite(point?.x) && Number.isFinite(point?.y)
      )
      .map(point => new THREE.Vector2(point.x, point.y))

    if (vectors.length < 3) {
      return undefined
    }

    const first = vectors[0]
    const last = vectors[vectors.length - 1]
    if (first.distanceToSquared(last) < 1e-18) {
      vectors.pop()
    }

    const uniqueKeys = new Set(
      vectors.map(point => `${point.x.toFixed(9)}:${point.y.toFixed(9)}`)
    )

    return uniqueKeys.size >= 3 ? vectors : undefined
  }
}
